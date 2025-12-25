"""
小红书API服务 - 云端部署版
解决全局变量问题,每次请求时加载Cookie
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import sys
import os
import json  # ✅ 添加缺失的 json 导入
import logging
from pathlib import Path

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 导入Spider_XHS
spider_xhs_path = os.path.join(os.path.dirname(__file__), 'Spider_XHS')
sys.path.append(spider_xhs_path)

# 切换到Spider_XHS目录并保持在该目录（不切回原目录）
# 这样execjs的require()语句才能正确找到static目录下的JavaScript文件
original_dir = os.getcwd()
os.chdir(spider_xhs_path)
logger.info(f"工作目录已切换到: {spider_xhs_path}，保持该目录以确保JavaScript文件加载正确")

# 在正确的目录下导入模块
from apis.xhs_pc_apis import XHS_Apis

app = FastAPI(title="小红书数据采集API")

# 添加CORS支持
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 从环境变量或.env加载Cookie
def get_cookie():
    """获取Cookie - 优先从环境变量,否则从.env文件"""
    # 1. 先尝试环境变量
    cookie = os.environ.get('XHS_COOKIE')
    if cookie:
        logger.info(f"从环境变量读取Cookie，长度: {len(cookie)}")
        return cookie

    # 2. 再尝试.env文件
    script_dir = Path(__file__).parent.absolute()
    env_path = script_dir / 'Spider_XHS' / '.env'

    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('XHS_COOKIE='):
                    cookie = line.split('=', 1)[1].strip('"').strip("'")
                    logger.info(f"从.env文件读取Cookie(XHS_COOKIE)，长度: {len(cookie)}")
                    return cookie
                elif line.startswith('COOKIES='):
                    cookie = line.split('=', 1)[1].strip('"').strip("'")
                    logger.info(f"从.env文件读取Cookie(COOKIES)，长度: {len(cookie)}")
                    return cookie

    logger.error("未找到Cookie配置")
    return None

class SearchRequest(BaseModel):
    keyword: str
    max_posts: int = 20
    sort_type: str = "general"  # general, time_descending, popularity_descending

class PostData(BaseModel):
    post_id: str
    title: str
    content: str
    author: str
    url: str
    keyword: str
    sentiment_score: float
    sentiment_label: str
    likes: int
    created_at: str

@app.get("/health")
async def health_check():
    """健康检查"""
    cookie = get_cookie()
    return {
        "status": "healthy",
        "service": "小红书数据采集API",
        "cookie_configured": bool(cookie)
    }

@app.post("/search")
async def search_posts(request: SearchRequest) -> List[PostData]:
    """
    搜索小红书笔记

    参数:
    - keyword: 搜索关键词
    - max_posts: 最大采集数量 (1-50)
    - sort_type: 排序方式 (general, time_descending, popularity_descending)

    返回:
    - List[PostData]: 采集的笔记列表
    """
    # 每次请求时获取Cookie
    cookie = get_cookie()

    if not cookie:
        raise HTTPException(
            status_code=500,
            detail="Cookie未配置，请在环境变量XHS_COOKIE或Spider_XHS/.env中配置Cookie"
        )

    try:
        logger.info(f"开始采集: 关键词={request.keyword}, 数量={request.max_posts}")

        # 初始化客户端（工作目录已在模块导入时切换到Spider_XHS）
        xhs_client = XHS_Apis()

        # 转换排序类型
        sort_type_map = {
            "general": 0,           # 综合排序
            "time_descending": 1,   # 时间倒序
            "popularity_descending": 2  # 热度倒序
        }
        sort_type_choice = sort_type_map.get(request.sort_type, 0)

        # 调用Spider_XHS搜索功能
        success, msg, result = xhs_client.search_some_note(
            query=request.keyword,
            require_num=request.max_posts,
            cookies_str=cookie,
            sort_type_choice=sort_type_choice
        )

        if not success:
            raise HTTPException(status_code=500, detail=f"搜索失败: {msg}")

        if not result or not isinstance(result, list):
            raise HTTPException(status_code=404, detail="未搜索到相关笔记")

        # 🔍 DEBUG: 记录原始数据结构
        if result and len(result) > 0:
            logger.info(f"原始数据结构示例: {json.dumps(result[0], ensure_ascii=False)[:500]}")

        # 转换为统一格式
        posts = []
        for item in result[:request.max_posts]:
            # 🔍 DEBUG: 记录每个item的结构（帮助诊断）
            if len(posts) == 0:  # 只记录第一条
                logger.info(f"处理第一个item，keys: {list(item.keys())}")

            # 提取笔记信息 - 正确的嵌套路径：item.note_card.display_title
            note_id = item.get('id', item.get('note_id', ''))

            # ✅ 修复：优先使用 note_card 下的字段（正确路径）
            title = (
                item.get('note_card', {}).get('display_title') or  # 主要路径
                item.get('note_card', {}).get('title') or
                item.get('display_title') or  # 备用路径（如果数据结构变化）
                item.get('title') or
                '无标题'
            )

            # ✅ 修复：从 note_card 提取描述
            content = (
                item.get('note_card', {}).get('desc') or
                item.get('desc') or
                ''
            )

            # ✅ 修复：从 note_card.user 提取作者昵称
            author = '未知用户'
            user_data = item.get('note_card', {}).get('user')
            if isinstance(user_data, dict) and user_data.get('nickname'):
                author = user_data.get('nickname')
            elif isinstance(item.get('user'), dict) and item.get('user', {}).get('nickname'):
                author = item.get('user', {}).get('nickname')

            # ✅ 修复：从 note_card.interact_info 提取点赞数
            likes = 0
            interact_info = item.get('note_card', {}).get('interact_info')
            if isinstance(interact_info, dict):
                likes = interact_info.get('liked_count', 0)
            if likes == 0 and isinstance(item.get('interact_info'), dict):
                likes = item.get('interact_info', {}).get('liked_count', 0)

            # ✅ 修复：从 note_card 提取时间
            created_at = (
                item.get('note_card', {}).get('time') or
                item.get('time') or
                ''
            )

            post = PostData(
                post_id=note_id,
                title=title,
                content=content,
                author=author,
                url=f"https://www.xiaohongshu.com/explore/{note_id}",
                keyword=request.keyword,
                sentiment_score=0.5,  # 情感分析在Worker中完成
                sentiment_label="neutral",
                likes=likes,
                created_at=created_at
            )
            posts.append(post)

        logger.info(f"采集成功! 共获取 {len(posts)} 条笔记")
        return posts

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"采集失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"采集失败: {str(e)}")

@app.get("/test-connection")
async def test_connection():
    """测试小红书API连接"""
    cookie = get_cookie()

    if not cookie:
        return {"success": False, "message": "Cookie未配置"}

    try:
        xhs_client = XHS_Apis()
        success, msg, result = xhs_client.search_some_note(
            query="测试",
            require_num=1,
            cookies_str=cookie
        )

        if success and result:
            first_post = result[0] if result else None
            if first_post:
                # ✅ 修复：使用正确的 note_card 路径提取标题
                title = (
                    first_post.get('note_card', {}).get('display_title') or
                    first_post.get('note_card', {}).get('title') or
                    first_post.get('display_title') or
                    first_post.get('title') or
                    '测试笔记'
                )
                return {
                    "success": True,
                    "message": "小红书API连接正常",
                    "test_post": {
                        "title": title,
                        "id": first_post.get('id', 'unknown')
                    }
                }
            else:
                return {"success": False, "message": "无测试数据"}
        else:
            return {"success": False, "message": f"连接测试失败: {msg}"}
    except Exception as e:
        return {"success": False, "message": f"连接测试失败: {str(e)}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "xhs_api_cloud:app",
        host="0.0.0.0",
        port=int(os.environ.get('PORT', 8000)),
        log_level="info"
    )
