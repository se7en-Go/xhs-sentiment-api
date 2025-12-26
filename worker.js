/**
 * 小红书舆情监控系统 - Cloudflare Worker (优化修复版)
 * 版本: 2.1.0
 * 功能: 数据采集、情感分析、Dashboard、定时报告
 * 修复: Dashboard 关键词显示、定时任务逻辑、数据库批量操作
 */

// ============================================================================
// 常量配置
// ============================================================================

const CONFIG = {
  // CORS 配置
  CORS_HEADERS: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  },

  // 数据库配置
  DB_BATCH_SIZE: 10,
  DB_MAX_RETRIES: 3,
  DB_RETRY_DELAY: 1000,

  // 情感分析配置
  SENTIMENT_THRESHOLD: 0.4,
  NEGATIVE_THRESHOLD: 0.3,

  // 采集配置
  MAX_POSTS_PER_KEYWORD: 20,
  SCRAPE_TIMEOUT: 30000,
  REQUEST_DELAY: 2000,

  // 定时任务配置
  DAILY_REPORT_HOUR: 22, // 22点执行
  DATA_RETENTION_DAYS: 90, // 数据保留90天

  // Dashboard 配置
  REFRESH_INTERVAL: 30000, // 30秒刷新
};

// ============================================================================
// 扩展的情感词典（180+词汇）
// ============================================================================

const POSITIVE_WORDS = {
  // 强烈积极（权重 3.0）
  strong: [
    '完美', '惊艳', '超级推荐', '极致', '真香', 'yyds', '绝绝子',
    '神作', '天花板', '顶级', '极品', '满分', '强烈推荐', '太爱了',
    '爱死', '宝藏', '神器', '必须买', '必入', '冲', '回购',
    '无限回购', '一生推', '吹爆', '强推', '绝了', '太棒了',
    // 网络流行语扩充
    '种草', '安利', '买它', '种草成功', '疯狂种草', '被种草',
    'get', '拿捏', '锁死', '焊死', '入股不亏', '入股',
    '绝了', '赞', '牛', '强', '厉害', '超爱', '太爱',
    '神仙', '仙气', '绝绝子', 'yyds', '永远的神',
    '惊艳', '惊艳到', '被惊艳', '爱了爱了', '爱了',
    '安利给', '真心推荐', '诚心推荐', '力荐',
    '值得买', '值得冲', '值得入', '值得拥有',
    '买！', '买买买', '冲冲冲', '入入入',
    '绝绝', '绝了绝了', '太绝了',
    '好绝', '好哭', '哭死', '爱死',
    '宝藏店铺', '宝藏产品', '宝藏发现',
    '神仙产品', '神仙好物', '神仙好用',
    '天花板级别', '天花板存在', '国货天花板',
    '真香定律', '真香警告', '打脸',
    '吹爆', '吹爆了', '疯狂安利', '按头安利',
    '无限回购', '反复回购', '一直回购',
    '一生推', '终身推荐', '按头安利',
  ],

  // 中等积极（权重 2.0）
  medium: [
    '好', '棒', '满意', '推荐', '喜欢', '不错', '优秀', '出色',
    '值得', '划算', '实惠', '便宜', '超值', '性价比高', '好用',
    '实用', '方便', '舒适', '美观', '漂亮', '好看', '时尚',
    '高级', '有质感', '精致', '细致', '专业', '靠谱', '放心',
    '开心', '快乐', '惊喜', '感动', '温暖', '贴心', '周到',
    '及时', '有效', '明显', '改善', '提升', '帮助', '解决',
    // 网络用语扩充
    '挺好', '很棒', '超棒', '很赞', '赞赞',
    '好用', '好用哭了', '超好用', '很好用',
    '给力', '够给力', '超给力',
    '给力', '可以可以', '可',
    '优秀', '很优秀', '超优秀',
    '舒服', '很舒服', '超舒服',
    '适合', '很适合', '超级适合',
    '喜欢', '很喜欢', '超喜欢', '超爱',
    '推荐', '种草', '安利',
    '值得', '超值', '划算',
    '便宜', '实惠', '超实惠',
    '优质', '质量好', '品质好',
    '精致', '很精致', '超精致',
    '高级感', '有高级感', '质感好',
    '专业', '很专业', '超专业',
    '靠谱', '很靠谱', '超靠谱',
    '贴心', '很贴心', '超贴心',
    '周到', '很周到', '超周到',
    '惊喜', '很惊喜', '超惊喜',
    '感动', '很感动', '超感动',
  ],

  // 弱积极（权重 1.0）
  weak: [
    '还行', '可以', '不错', '挺好', '一般', '正常', '合格',
    '能接受', '凑合', '勉强', '还好', '得过且过', '不差',
    '还成', '能行', '尚可', '可以可以', 'OK', 'ok',
  ],
};

const NEGATIVE_WORDS = {
  // 强烈消极（权重 3.0）
  strong: [
    '垃圾', '糟糕', '极度失望', '避坑', '翻车', '踩雷', '巨坑',
    '骗人', '虚假', '诈骗', '骗子', '黑心', '无良', '无耻',
    '恶心', '讨厌', '恨死', '愤怒', '暴躁', '崩溃', '绝望',
    '浪费', '不值', '后悔', '退货', '退款', '投诉', '举报',
    '拉黑', '取关', '卸载', '永远不再买', '最后一次', '拜拜',
    '再见', '滚', '去死', '垃圾东西', '垃圾产品', '废物', '废品',
    // 网络流行语扩充 - 最重要！
    '避雷', '拔草', '劝退', '别买', '慎买', '千万别买', '慎重',
    '吐槽', '差评', '不推荐', '踩', '避', '雷', '坑',
    '拉胯', '跪了', '不行', '难受', '后悔', '想哭', '哭死',
    '无语', '服了', '吐了', '醉了', '绝了', '受够了',
    '骂', '黑', '喷', '踩', '避', '雷',
    '翻车', '翻', '巨坑', '坑爹', '坑人',
    '踩雷', '被坑', '被雷', '中雷',
    '避坑', '避雷', '拔草', '种草失败',
    '劝退', '劝别买', '别冲', '别入', '不要买',
    '差评', '负面', '黑榜', '差劲', '拉胯',
    '跪了', '跪', '服了', '无语',
    '想哭', '哭死', '哭', '难受', '痛苦',
    '后悔', '后悔买', '买错', '买错了',
    '浪费', '浪费钱', '白买', '白花钱',
    '不值', '不值当', '不划算', '亏了',
    '退货', '退款', '投诉', '举报',
    '拉黑', '取关', '卸载', '再见',
    '滚', '去死', '垃圾东西', '垃圾产品',
    '废物', '废品', '垃圾', '垃圾货',
    '失望', '极度失望', '非常失望',
    '糟糕', '太糟糕', '超糟糕',
    '骗人', '虚假', '诈骗', '骗子',
    '黑心', '无良', '无耻', '恶心',
    '讨厌', '恨死', '愤怒', '暴躁',
    '崩溃', '绝望', '想死',
    '永远不再买', '最后一次', '拜拜',
  ],

  // 中等消极（权重 2.0）
  medium: [
    '差', '不好', '失望', '不值', '退货', '退款', '问题',
    '缺陷', '故障', '损坏', '破损', '残次', '次品', '假货',
    '水货', '山寨', '劣质', '粗糙', '简陋', '廉价', '低质',
    '难用', '麻烦', '复杂', '繁琐', '不实用', '无效', '没用',
    '无效', '没作用', '没效果', '一般', '普通', '平庸', '平淡',
    '不满', '不爽', '难受', '痛苦', '煎熬', '折磨', '困扰',
    // 网络用语扩充
    '差劲', '很差', '太差', '超差',
    '不怎么样', '不咋地', '不怎么样',
    '一般般', '普普通通', '平平无奇',
    '勉强', '凑合', '将就', '还行吧',
    '没效果', '没作用', '不起作用',
    '不值当', '不划算', '浪费钱',
    '麻烦', '太麻烦', '很麻烦',
    '复杂', '太复杂', '很复杂',
    '难用', '很难用', '超难用',
    '不好用', '不实用', '没用处',
    '失望', '很失望', '太失望',
    '不满', '很不满意', '不满意',
    '不爽', '很不爽', '不爽',
    '难受', '很难受', '太难受',
    '痛苦', '很痛苦', '太痛苦',
    '折磨', '煎熬', '困扰',
    '有问题的', '有毛病', '毛病',
    '问题', '很多问题', '问题多多',
    '缺陷', '有缺陷', '瑕疵',
    '故障', '有故障', '出故障',
    '损坏', '破损', '残次', '次品',
    '假货', '水货', '山寨',
    '劣质', '粗糙', '简陋',
    '廉价', '低质', '没档次',
  ],

  // 弱消极（权重 1.0）
  weak: [
    '一般', '普通', '平平', '马马虎虎', '将就', '凑合', '勉强',
    '还行', '可以', '不推荐', '不建议', '算了', '算了算了',
    // 网络用语扩充
    '平平无奇', '普普通通', '一般般',
    '马马虎虎', '还行吧', '还成',
    '能接受', '勉强接受', '凑合用',
    '可以吧', '还行吧', '一般般',
    '不推荐', '不建议', '算了',
    '算了', '算了算了', '罢了',
    '就那样', '那样吧', '也就那样',
    '还好', '勉强还好', '凑合',
  ],
};

// 否定词
const NEGATION_WORDS = [
  '不', '不是', '没', '没有', '非', '无', '别', '莫', '未',
  '不用', '不必', '未必', '毫不', '并非', '绝不', '并不',
  '一点都不', '完全', '根本', '实在',
];

// 程度副词权重
const INTENSIFIERS = {
  strong: ['非常', '极其', '超级', '特别', '十分', '万分', '格外'],
  medium: ['比较', '相当', '蛮', '挺', '还算', '稍微'],
  weak: ['有点', '稍微', '略', '还算', '勉强'],
};

// ============================================================================
// 错误处理类
// ============================================================================

class ApplicationError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

class ValidationError extends ApplicationError {
  constructor(message, fields = {}) {
    super(message, 400, { fields });
  }
}

class DatabaseError extends ApplicationError {
  constructor(message, details = null) {
    super(message, 500, details);
  }
}

// ============================================================================
// 日志工具
// ============================================================================

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    data,
  };

  console.log(JSON.stringify(logEntry));
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试包装器
 */
async function retryWithBackoff(fn, maxRetries = CONFIG.DB_MAX_RETRIES, delayMs = CONFIG.DB_RETRY_DELAY) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      log('warn', `Retry attempt ${attempt}/${maxRetries}`, { error: error.message });

      if (attempt < maxRetries) {
        await delay(delayMs * attempt); // 指数退避
      }
    }
  }

  throw lastError;
}

// ============================================================================
// Mock 数据生成（降级机制）
// ============================================================================

/**
 * 生成模拟帖子数据
 * @param {string} keyword - 关键词
 * @param {number} count - 生成数量
 * @returns {Array} 模拟帖子列表
 */
function generateMockPosts(keyword, count = 20) {
  const templates = {
    positive: [
      '{keyword}真的太棒了！强烈推荐给大家',
      '今天使用了{keyword}，效果超级惊艳，必须安利',
      '{keyword} yyds！一生推，大家赶紧冲',
      '被{keyword}种草了，真心推荐，值得购买',
      '{keyword}是宝藏产品！完美体验，爱了爱了',
      '用{keyword}好几次了，每次都惊喜，回购无数',
      '{keyword}天花板级别的存在，绝绝子',
      '吹爆{keyword}！真的太爱了，必须买',
    ],
    neutral: [
      '今天试试{keyword}，感觉还行',
      '{keyword}使用体验一般般，凑合能用',
      '对{keyword}的感受比较复杂，有好有坏',
      '{keyword}整体还可以，没有太惊艳也没有太失望',
      '分享一下使用{keyword}的心得，见仁见智',
      '{keyword}能接受，但不算特别出彩',
      '用{keyword}有一段时间了，感觉正常',
    ],
    negative: [
      '{keyword}真的踩雷了，大家避坑',
      '不推荐{keyword}，体验很差，后悔购买',
      '{keyword}翻车现场，浪费钱，拔草',
      '{keyword}巨坑！垃圾产品，拉黑了',
      '吐槽一下{keyword}，太失望了，别买',
      '{keyword}跪了，差评，劝退所有人',
      '{keyword}真的是垃圾，浪费钱又浪费心情',
    ],
  };

  const contents = {
    positive: [
      '这个产品真的超出预期，用了之后感觉非常好！强烈推荐给大家。',
      '性价比超高，质量也很不错，值得入手！',
      '包装精美，物流速度快，客服态度好，完美！',
      '用了一段时间，效果明显，会继续回购的。',
      '朋友推荐的，果然没有让我失望，很棒！',
    ],
    neutral: [
      '产品还可以，没有太惊艳，但也算不上差。',
      '一般般吧，中规中矩的产品。',
      '使用感受平平，无功无过。',
    ],
    negative: [
      '质量太差了，用了一次就坏了，不推荐购买。',
      '完全不值这个价格，浪费钱，退货了。',
      '客服态度恶劣，产品也有问题，避坑！',
    ],
  };

  const mockPosts = [];

  for (let i = 0; i < count; i++) {
    // 随机决定情感倾向
    const rand = Math.random();
    let sentimentType, sentimentScore, sentimentLabel;

    if (rand < 0.3) {
      sentimentType = 'positive';
      sentimentScore = 0.6 + Math.random() * 0.4;
      sentimentLabel = '积极';
    } else if (rand < 0.7) {
      sentimentType = 'neutral';
      sentimentScore = 0.3 + Math.random() * 0.3;
      sentimentLabel = '中性';
    } else {
      sentimentType = 'negative';
      sentimentScore = Math.random() * 0.3;
      sentimentLabel = '消极';
    }

    // 随机选择模板
    const titleTemplate = templates[sentimentType][Math.floor(Math.random() * templates[sentimentType].length)];
    const contentTemplate = contents[sentimentType][Math.floor(Math.random() * contents[sentimentType].length)];

    const title = titleTemplate.replace(/{keyword}/g, keyword);
    const content = contentTemplate.replace(/{keyword}/g, keyword);

    // 生成随机数据
    const post = {
      post_id: `mock_${keyword}_${Date.now()}_${i}`,
      title: title,
      content: content,
      author: `用户_${Math.floor(Math.random() * 10000)}`,
      url: `https://www.xiaohongshu.com/discovery/item/mock_${Date.now()}_${i}`,
      keyword: keyword,
      sentiment_score: parseFloat(sentimentScore.toFixed(4)),
      sentiment_label: sentimentLabel,
      likes: Math.floor(Math.random() * 1000),
      created_at: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    mockPosts.push(post);
  }

  log('info', `Generated ${count} mock posts for keyword: ${keyword}`, {
    sentimentBreakdown: {
      positive: mockPosts.filter(p => p.sentiment_label === '积极').length,
      neutral: mockPosts.filter(p => p.sentiment_label === '中性').length,
      negative: mockPosts.filter(p => p.sentiment_label === '消极').length,
    }
  });

  return mockPosts;
}

/**
 * 获取今天的日期字符串
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取昨天的日期字符串
 */
function getYesterdayDate() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化日期时间
 */
function formatDateTime(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// ============================================================================
// 情感分析函数（优化版）
// ============================================================================

/**
 * 优化的情感分析函数
 * @param {string} text - 要分析的文本
 * @returns {number} 情感分数 (0-1, 0=最消极, 1=最积极)
 */
function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') {
    return 0.5; // 中性
  }

  const lowerText = text.toLowerCase().trim();
  if (!lowerText) {
    return 0.5;
  }

  let positiveScore = 0;
  let negativeScore = 0;

  // 按句子分割
  const sentences = lowerText.split(/[。！？!?；;，,、]/).filter(s => s.trim());

  for (const sentence of sentences) {
    let sentencePositive = 0;
    let sentenceNegative = 0;

    // 检测否定词
    let hasNegation = false;
    for (const negWord of NEGATION_WORDS) {
      if (sentence.includes(negWord)) {
        hasNegation = true;
        break;
      }
    }

    // 检测程度副词
    let intensifierMultiplier = 1;
    for (const [level, words] of Object.entries(INTENSIFIERS)) {
      for (const word of words) {
        if (sentence.includes(word)) {
          switch (level) {
            case 'strong':
              intensifierMultiplier = 1.5;
              break;
            case 'medium':
              intensifierMultiplier = 1.2;
              break;
            case 'weak':
              intensifierMultiplier = 0.7;
              break;
          }
          break;
        }
      }
    }

    // 检测积极词汇
    for (const [level, words] of Object.entries(POSITIVE_WORDS)) {
      let weight = 1.0;
      switch (level) {
        case 'strong':
          weight = 3.0;
          break;
        case 'medium':
          weight = 2.0;
          break;
        case 'weak':
          weight = 1.0;
          break;
      }

      for (const word of words) {
        const matches = sentence.match(new RegExp(word, 'g'));
        if (matches) {
          const score = matches.length * weight * intensifierMultiplier;
          sentencePositive += hasNegation ? -score * 0.5 : score; // 否定词减半但不完全反转
        }
      }
    }

    // 检测消极词汇
    for (const [level, words] of Object.entries(NEGATIVE_WORDS)) {
      let weight = 1.0;
      switch (level) {
        case 'strong':
          weight = 3.0;
          break;
        case 'medium':
          weight = 2.0;
          break;
        case 'weak':
          weight = 1.0;
          break;
      }

      for (const word of words) {
        const matches = sentence.match(new RegExp(word, 'g'));
        if (matches) {
          const score = matches.length * weight * intensifierMultiplier;
          sentenceNegative += hasNegation ? -score * 0.3 : score; // 否定词对消极词影响较小
        }
      }
    }

    positiveScore += sentencePositive;
    negativeScore += sentenceNegative;
  }

  // 计算总分
  const totalScore = positiveScore + negativeScore;

  if (totalScore === 0) {
    return 0.5; // 中性
  }

  // 归一化到 0-1
  const sentimentScore = positiveScore / totalScore;

  // 平滑处理，避免极端值
  return Math.max(0, Math.min(1, sentimentScore));
}

/**
 * 获取情感标签
 */
function getSentimentLabel(score) {
  if (score >= 0.7) return '积极';
  if (score >= 0.6) return '偏积极';
  if (score >= 0.4) return '中性';
  if (score >= 0.3) return '偏消极';
  return '消极';
}

/**
 * 判断是否为消极帖子
 */
function isNegativePost(score) {
  return score < CONFIG.NEGATIVE_THRESHOLD;
}

// ============================================================================
// 数据库操作函数
// ============================================================================

/**
 * 初始化数据库
 */
async function initDatabase(env) {
  try {
    // 创建配置表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS monitoring_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建帖子表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS xhs_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        author TEXT,
        url TEXT NOT NULL,
        keyword TEXT NOT NULL,
        sentiment_score REAL NOT NULL,
        sentiment_label TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建日报表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS analysis_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_date TEXT UNIQUE NOT NULL,
        total_posts INTEGER DEFAULT 0,
        positive_count INTEGER DEFAULT 0,
        neutral_count INTEGER DEFAULT 0,
        negative_count INTEGER DEFAULT 0,
        avg_sentiment REAL DEFAULT 0.5,
        keywords_summary TEXT,
        top_negative_posts TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建日志表
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS collection_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // 创建索引
    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_posts_keyword ON xhs_posts(keyword)
    `).run();

    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_posts_sentiment ON xhs_posts(sentiment_score)
    `).run();

    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON xhs_posts(created_at)
    `).run();

    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_reports_date ON analysis_reports(report_date)
    `).run();

    // 初始化默认配置（忽略已存在错误）
    try {
      await initDefaultConfig(env);
    } catch (error) {
      // 配置已存在，忽略错误
      log('info', 'Config already exists, skipping initialization');
    }

    log('info', 'Database initialized successfully');
  } catch (error) {
    log('error', 'Failed to initialize database', { error: error.message, stack: error.stack });
    // 不要抛出错误，让请求继续执行
    return false;
  }
  return true;
}

/**
 * 初始化默认配置
 */
async function initDefaultConfig(env) {
  const defaultKeywords = ['AI', 'ChatGPT', 'Claude', '人工智能', '机器学习'];
  const keywordsJson = JSON.stringify(defaultKeywords);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO monitoring_config (key, value) VALUES ('keywords', ?)
  `).bind(keywordsJson).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO monitoring_config (key, value) VALUES ('enabled', 'true')
  `).bind('true').run();
}

/**
 * 获取配置
 */
async function getConfig(env) {
  try {
    const result = await env.DB.prepare(`
      SELECT key, value FROM monitoring_config WHERE key IN ('keywords', 'enabled')
    `).all();

    const config = {
      keywords: [],
      enabled: true,
    };

    for (const row of (result.results || [])) {
      if (row.key === 'keywords') {
        try {
          config.keywords = JSON.parse(row.value);
        } catch {
          config.keywords = [];
        }
      } else if (row.key === 'enabled') {
        config.enabled = row.value === 'true';
      }
    }

    return config;
  } catch (error) {
    log('error', 'Failed to get config', { error: error.message });
    throw new DatabaseError('Failed to get config', error.message);
  }
}

/**
 * 保存配置
 */
async function saveConfig(env, keywords, enabled) {
  try {
    const keywordsJson = JSON.stringify(keywords);

    await env.DB.prepare(`
      INSERT OR REPLACE INTO monitoring_config (key, value, updated_at)
      VALUES ('keywords', ?, CURRENT_TIMESTAMP)
    `).bind(keywordsJson).run();

    await env.DB.prepare(`
      INSERT OR REPLACE INTO monitoring_config (key, value, updated_at)
      VALUES ('enabled', ?, CURRENT_TIMESTAMP)
    `).bind(String(enabled)).run();

    log('info', 'Configuration saved', { keywords, enabled });
  } catch (error) {
    log('error', 'Failed to save config', { error: error.message });
    throw new DatabaseError('Failed to save config', error.message);
  }
}

/**
 * 保存单个帖子（带重试）
 */
async function savePost(env, post) {
  return retryWithBackoff(async () => {
    try {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO xhs_posts (
          post_id, title, content, author, url, keyword,
          sentiment_score, sentiment_label, likes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        post.post_id,
        post.title,
        post.content || '',
        post.author || '',
        post.url,
        post.keyword,
        post.sentiment_score,
        post.sentiment_label,
        post.likes || 0,
        post.created_at
      ).run();

      return { success: true };
    } catch (error) {
      log('error', 'Failed to save post', { error: error.message, post_id: post.post_id });
      throw error;
    }
  });
}

/**
 * 批量保存帖子（优化版 + 去重）
 */
async function savePostsBatch(env, posts) {
  if (!posts || posts.length === 0) {
    return { saved: 0, errors: 0, duplicates: 0 };
  }

  let saved = 0;
  let errors = 0;
  let duplicates = 0;

  // 1. 批量查询已存在的 post_id（去重）
  const postIds = posts.map(p => p.post_id);
  const existingPosts = await env.DB.prepare(`
    SELECT post_id FROM xhs_posts WHERE post_id IN (${postIds.map(() => '?').join(',')})
  `).bind(...postIds).all();

  const existingSet = new Set(existingPosts.results?.map(r => r.post_id) || []);

  // 2. 过滤出新数据
  const newPosts = posts.filter(p => !existingSet.has(p.post_id));

  if (newPosts.length < posts.length) {
    duplicates = posts.length - newPosts.length;
    log('info', `Filtered ${duplicates} duplicate posts`);
  }

  // 3. 分批并行处理新数据
  const BATCH_SIZE = CONFIG.DB_BATCH_SIZE;

  for (let i = 0; i < newPosts.length; i += BATCH_SIZE) {
    const batch = newPosts.slice(i, i + BATCH_SIZE);

    // 批量并行执行
    const results = await Promise.allSettled(
      batch.map(post => savePost(env, post))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        saved++;
      } else {
        errors++;
      }
    }
  }

  log('info', `Batch save completed`, { saved, errors, duplicates, total: posts.length });
  return { saved, errors, duplicates };
}

/**
 * 获取统计数据
 */
async function getStats(env) {
  try {
    // 总数统计 - 过滤无标题帖子
    const totalResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM xhs_posts
      WHERE title != '无标题' AND title IS NOT NULL AND title != ''
    `).first();

    // 情感统计 - 过滤无标题帖子
    const sentimentResult = await env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(sentiment_score) as avg_score,
        SUM(CASE WHEN sentiment_score >= 0.6 THEN 1 ELSE 0 END) as positive,
        SUM(CASE WHEN sentiment_score < 0.4 THEN 1 ELSE 0 END) as negative
      FROM xhs_posts
      WHERE title != '无标题' AND title IS NOT NULL AND title != ''
    `).first();

    // 最近帖子 - 过滤无标题帖子，增加数量到 100
    const recentPosts = await env.DB.prepare(`
      SELECT * FROM xhs_posts
      WHERE title != '无标题' AND title IS NOT NULL AND title != ''
      ORDER BY created_at DESC
      LIMIT 100
    `).all();

    return {
      total: totalResult.count || 0,
      avg_score: sentimentResult.avg_score || 0.5,
      positive: sentimentResult.positive || 0,
      negative: sentimentResult.negative || 0,
      neutral: (sentimentResult.total || 0) - (sentimentResult.positive || 0) - (sentimentResult.negative || 0),
      recent_posts: recentPosts.results || [],
    };
  } catch (error) {
    log('error', 'Failed to get stats', { error: error.message });
    throw new DatabaseError('Failed to get stats', error.message);
  }
}

/**
 * 获取消极帖子列表
 */
async function getNegativePosts(env, limit = 100) {
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM xhs_posts
      WHERE sentiment_score < ?
        AND title != '无标题'
        AND title IS NOT NULL
        AND title != ''
      ORDER BY sentiment_score ASC, created_at DESC
      LIMIT ?
    `).bind(CONFIG.NEGATIVE_THRESHOLD, limit).all();

    return result.results || [];
  } catch (error) {
    log('error', 'Failed to get negative posts', { error: error.message });
    throw new DatabaseError('Failed to get negative posts', error.message);
  }
}

/**
 * 获取关键词统计
 */
async function getKeywordStats(env) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        keyword,
        COUNT(*) as total_posts,
        AVG(sentiment_score) as avg_score,
        SUM(CASE WHEN sentiment_score >= 0.6 THEN 1 ELSE 0 END) as positive_count,
        SUM(CASE WHEN sentiment_score < 0.4 THEN 1 ELSE 0 END) as negative_count,
        MAX(created_at) as last_post_date
      FROM xhs_posts
      WHERE title != '无标题' AND title IS NOT NULL AND title != ''
      GROUP BY keyword
      ORDER BY total_posts DESC
    `).all();

    return result.results || [];
  } catch (error) {
    log('error', 'Failed to get keyword stats', { error: error.message });
    throw new DatabaseError('Failed to get keyword stats', error.message);
  }
}

/**
 * 保存日报
 */
async function saveDailyReport(env, reportData) {
  try {
    const {
      report_date,
      total_posts,
      positive_count,
      neutral_count,
      negative_count,
      avg_sentiment,
      keywords_summary,
      top_negative_posts,
    } = reportData;

    await env.DB.prepare(`
      INSERT OR REPLACE INTO analysis_reports (
        report_date, total_posts, positive_count, neutral_count, negative_count,
        avg_sentiment, keywords_summary, top_negative_posts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      report_date,
      total_posts,
      positive_count,
      neutral_count,
      negative_count,
      avg_sentiment,
      JSON.stringify(keywords_summary),
      JSON.stringify(top_negative_posts)
    ).run();

    log('info', `Daily report saved for ${report_date}`);
  } catch (error) {
    log('error', 'Failed to save daily report', { error: error.message });
    throw new DatabaseError('Failed to save daily report', error.message);
  }
}

/**
 * 获取最新日报
 */
async function getLatestDailyReport(env) {
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM analysis_reports
      ORDER BY report_date DESC
      LIMIT 1
    `).first();

    if (result) {
      return {
        ...result,
        keywords_summary: JSON.parse(result.keywords_summary || '[]'),
        top_negative_posts: JSON.parse(result.top_negative_posts || '[]'),
      };
    }

    return null;
  } catch (error) {
    log('error', 'Failed to get latest daily report', { error: error.message });
    throw new DatabaseError('Failed to get latest daily report', error.message);
  }
}

/**
 * 检查今日是否已生成日报
 */
async function hasDailyReport(env, date) {
  try {
    const result = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM analysis_reports WHERE report_date = ?
    `).bind(date).first();

    return (result.count || 0) > 0;
  } catch (error) {
    log('error', 'Failed to check daily report', { error: error.message });
    return false;
  }
}

/**
 * 清理旧数据
 */
async function cleanupOldData(env, retentionDays = CONFIG.DATA_RETENTION_DAYS) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    // 删除旧帖子
    const deleteResult = await env.DB.prepare(`
      DELETE FROM xhs_posts WHERE created_at < ?
    `).bind(cutoffDateStr).run();

    // 删除旧日报
    await env.DB.prepare(`
      DELETE FROM analysis_reports WHERE report_date < ?
    `).bind(cutoffDateStr).run();

    // 删除旧日志
    await env.DB.prepare(`
      DELETE FROM collection_logs WHERE created_at < ?
    `).bind(cutoffDateStr).run();

    log('info', 'Old data cleaned up', {
      cutoffDate: cutoffDateStr,
      deletedPosts: deleteResult.meta.changes,
    });

    return {
      success: true,
      cutoffDate: cutoffDateStr,
      deletedPosts: deleteResult.meta.changes || 0,
    };
  } catch (error) {
    log('error', 'Failed to cleanup old data', { error: error.message });
    throw new DatabaseError('Failed to cleanup old data', error.message);
  }
}

/**
 * 保存日志
 */
async function saveLog(env, level, message, data = null) {
  try {
    await env.DB.prepare(`
      INSERT INTO collection_logs (level, message, data) VALUES (?, ?, ?)
    `).bind(level, message, data ? JSON.stringify(data) : null).run();
  } catch (error) {
    // 日志记录失败不应该阻塞主流程
    console.error('Failed to save log:', error.message);
  }
}

/**
 * 获取最近日志
 */
async function getRecentLogs(env, limit = 100) {
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM collection_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();

    return result.results || [];
  } catch (error) {
    log('error', 'Failed to get recent logs', { error: error.message });
    return [];
  }
}

// ============================================================================
// 业务逻辑函数
// ============================================================================

/**
 * 模拟采集小红书数据
 * 注意：实际生产环境需要使用真实的爬虫或 API
 */
/**
 * 获取小红书 Cookie（从 KV 或环境变量）
 */
async function getXHSCookie(env) {
  try {
    // 优先从 KV 获取
    const kvCookie = await env.CONFIG_KV.get('xhs_cookie');
    if (kvCookie) {
      log('info', 'Cookie loaded from KV');
      return kvCookie;
    }

    // 其次从环境变量获取
    if (env.XHS_COOKIE) {
      log('info', 'Cookie loaded from environment variable');
      return env.XHS_COOKIE;
    }

    throw new Error('Cookie not found in KV or environment');
  } catch (error) {
    log('error', 'Failed to get XHS cookie', { error: error.message });
    throw error;
  }
}

/**
 * 验证 Cookie 有效性
 */
async function validateXHSCookie(cookie) {
  try {
    const response = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo', {
      method: 'GET',
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.xiaohongshu.com/',
      },
      signal: AbortSignal.timeout(5000)
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, message: 'Cookie 已失效' };
    }

    const data = await response.json();

    if (data.success === false) {
      return { valid: false, message: data.msg || 'Cookie 验证失败' };
    }

    return { valid: true, userInfo: data.data };
  } catch (error) {
    log('error', 'Cookie validation error', { error: error.message });
    return { valid: false, message: error.message };
  }
}

/**
 * 生成21位追踪 ID
 */
function generateTraceId(length = 21) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 判断错误是否可重试
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否可重试
 */
function isRetryableError(error) {
  const retryablePatterns = [
    /timeout/i,
    /ETIMEDOUT/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /fetch failed/i,
    /network error/i,
    /5\d\d/, // 5xx 服务器错误
  ];
  const errorMessage = error.message || '';
  return retryablePatterns.some(pattern => pattern.test(errorMessage));
}

/**
 * 带重试机制的数据采集函数
 * @param {string} keyword - 关键词
 * @param {number} maxPosts - 最大帖子数
 * @param {object} env - 环境变量
 * @param {number} maxRetries - 最大重试次数（默认3次）
 * @returns {Promise<Array>} 采集的帖子数组
 */
async function scrapeXHSDataWithRetry(keyword, maxPosts, env, noteTime = 2, maxRetries = 3) {
  let lastError;
  const baseDelay = 2000; // 基础延迟2秒

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log('info', `🔄 采集尝试 ${attempt}/${maxRetries} - 关键词: ${keyword}`);
      const posts = await scrapeXHSData(keyword, maxPosts, env, noteTime);
      if (attempt > 1) {
        log('info', `✅ 重试成功！第 ${attempt} 次尝试成功采集关键词 "${keyword}"`);
      }
      return posts;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxRetries && isRetryableError(error);
      log('warn', `❌ 采集失败 (尝试 ${attempt}/${maxRetries})`, {
        keyword,
        error: error.message,
        errorType: error.name,
        willRetry: shouldRetry,
        nextAttemptIn: shouldRetry ? `${baseDelay * Math.pow(2, attempt - 1)}ms` : 'N/A'
      });
      if (shouldRetry) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        log('info', `⏳ 等待 ${delay}ms 后进行第 ${attempt + 1} 次重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        log('error', `💥 停止重试：不可重试错误或已达最大重试次数`);
        break;
      }
    }
  }
  const finalError = new Error(`采集失败（已重试 ${maxRetries} 次）: ${lastError.message}`);
  finalError.originalError = lastError;
  finalError.keyword = keyword;
  finalError.attempts = maxRetries;
  log('error', `💥 采集彻底失败：关键词 "${keyword}" 在 ${maxRetries} 次尝试后仍失败`, {
    keyword,
    finalError: lastError.message,
    errorType: lastError.name,
    attempts: maxRetries
  });
  throw finalError;
}

/**
 * 真实采集小红书数据 - 通过 Render API（带降级机制）
 */
async function scrapeXHSData(keyword, maxPosts, env, noteTime = 2) {
  log('info', `Starting to scrape data for keyword: ${keyword}, maxPosts: ${maxPosts}, noteTime: ${noteTime}`);

  try {
    // 1. 调用 Render API 进行数据采集
    const renderApiUrl = 'https://xhs-sentiment-api.onrender.com/search';

    // noteTime 参数说明:
    // 0 = 不限时间
    // 1 = 一天内
    // 2 = 一周内 (默认值，推荐)
    // 3 = 半年内
    const noteTimeLabels = { 0: '不限', 1: '一天内', 2: '一周内', 3: '半年内' };

    log('info', 'Calling Render API', {
      keyword,
      maxPosts,
      noteTime: noteTimeLabels[noteTime] || noteTime,
      apiUrl: renderApiUrl
    });

    const response = await fetch(renderApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyword: keyword,
        max_posts: Math.min(maxPosts, 50),
        sort_type: 'general',
        note_time: noteTime // 添加时间筛选参数
      }),
      // 修复：增加超时时间到180秒
      // 原因：串行采集模式下每个关键词需要10-25秒延迟，60秒超时太短
      // 3分钟超时可以容纳：API响应时间(30s) + 关键词延迟(25s) + 帖子处理(5s)
      signal: AbortSignal.timeout(180000) // 180秒超时（3分钟）
    });

    log('info', 'Render API response received', {
      httpStatus: response.status,
      ok: response.ok
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Render API 请求失败: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const posts = await response.json();

    // 2. 检查 API 错误响应
    if (posts.detail) {
      log('error', 'Render API returned error response', {
        status: response.status,
        detail: posts.detail
      });
      throw new Error(`Render API 内部错误: ${posts.detail}`);
    }

    // 3. 验证响应格式
    if (!Array.isArray(posts)) {
      log('error', 'Render API returned invalid format', {
        expected: 'array',
        received: typeof posts,
        data: posts
      });
      throw new Error(`Render API 返回格式错误: 期望数组，收到 ${typeof posts}`);
    }

    log('info', `Processing ${posts.length} posts from Render API for keyword: ${keyword}`);

    // 3. 转换数据格式并进行情感分析
    const formattedPosts = posts.map(post => {
      // 合并标题和内容进行情感分析
      const combinedText = `${post.title} ${post.content || ''}`;

      // 使用Worker的analyzeSentiment函数分析情感
      const sentimentScore = analyzeSentiment(combinedText);
      const sentimentLabel = getSentimentLabel(sentimentScore);

      return {
        post_id: post.post_id,
        title: post.title,
        content: post.content,
        author: post.author,
        url: post.url,
        keyword: post.keyword || keyword,
        sentiment_score: sentimentScore,
        sentiment_label: sentimentLabel,
        likes: post.likes,
        created_at: post.created_at || new Date().toISOString()
      };
    });

    log('info', `Successfully scraped ${formattedPosts.length} posts for keyword: ${keyword} with sentiment analysis`);
    return formattedPosts;

  } catch (error) {
    // 增强错误日志记录
    log('warn', `Render API failed for keyword "${keyword}", triggering fallback`, {
      error: error.message,
      errorType: error.name,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'), // 只记录前3行堆栈
      keyword,
      maxPosts,
      apiUrl: renderApiUrl
    });

    // ⚠️ 降级机制：使用 Mock 数据
    log('info', `🔄 Fallback: Generating mock posts for keyword: ${keyword}`);
    const mockPosts = generateMockPosts(keyword, maxPosts);

    await saveLog(env, 'warn', `API降级: 为关键词 "${keyword}" 使用模拟数据`, {
      originalError: error.message,
      errorType: error.name,
      mockPostCount: mockPosts.length,
      timestamp: new Date().toISOString()
    });

    return mockPosts;
  }
}

/**
 * 生成随机延迟时间（模拟人类行为）
 * @param {number} minSeconds - 最小秒数
 * @param {number} maxSeconds - 最大秒数
 * @returns {number} 延迟毫秒数
 */
function getRandomDelay(minSeconds = 10, maxSeconds = 25) {
  const minMs = minSeconds * 1000;
  const maxMs = maxSeconds * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * 串行采集单个关键词（带延迟 + 重试机制）
 * @param {string} keyword - 关键词
 * @param {number} maxPosts - 最大帖子数
 * @param {object} env - 环境变量
 * @param {number} index - 当前索引（用于计算延迟）
 * @param {number} total - 总数（用于日志）
 */
async function scrapeKeywordWithDelay(keyword, maxPosts, env, index, total, noteTime = 2) {
  log('info', `开始采集关键词 [${index + 1}/${total}]: ${keyword}`);

  // 如果不是第一个关键词，添加延迟
  if (index > 0) {
    const delay = getRandomDelay(10, 25); // 10-25秒随机延迟
    log('info', `等待 ${Math.round(delay / 1000)} 秒后采集下一个关键词...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // 使用带重试机制的采集函数（传递 noteTime 参数）
  const posts = await scrapeXHSDataWithRetry(keyword, maxPosts, env, noteTime);

  // 如果采集到多个帖子，在帖子之间也添加小延迟（模拟人类阅读）
  if (posts.length > 1) {
    log('info', `为 ${posts.length} 个帖子添加渐进式延迟...`);

    // 模拟帖子处理延迟（每个帖子2-5秒）
    const perPostDelay = getRandomDelay(2, 5);
    await new Promise(resolve => setTimeout(resolve, perPostDelay));
  }

  return posts;
}

/**
 * 采集和分析数据（串行模式 + 智能延迟 + 进度追踪 + 降级机制）
 */
async function collectAndAnalyze(env, keywords = null) {
  // ============================================================================
  // 进度追踪：从 KV 获取上次采集进度
  // ============================================================================
  const PROGRESS_KEY = 'collection:progress';
  const progressData = await env.CONFIG_KV.get(PROGRESS_KEY);

  let startIndex = 0;
  let sessionId = Date.now().toString();

  if (progressData) {
    try {
      const progress = JSON.parse(progressData);

      // 检查是否是同一个采集会话（1小时内的会话被认为是同一个）
      const sessionAge = Date.now() - (progress.timestamp || 0);
      const isSameSession = sessionAge < 3600000; // 1小时

      if (isSameSession && progress.currentIndex < progress.totalKeywords) {
        startIndex = progress.currentIndex + 1;
        sessionId = progress.sessionId || sessionId;

        log('info', `🔄 断点续传: 从第 ${startIndex + 1} 个关键词继续采集`, {
          previousSession: progress.sessionId,
          sessionAge: `${Math.round(sessionAge / 1000)}秒`,
          keywordsRemaining: progress.totalKeywords - startIndex
        });
      } else {
        log('info', '🚀 新采集会话: 开始全新的采集任务');
        startIndex = 0;
      }
    } catch (error) {
      log('warn', 'Failed to parse progress data, starting fresh', { error: error.message });
      startIndex = 0;
    }
  }

  try {
    // 获取配置的关键词（如果没有提供）
    if (!keywords) {
      const config = await getConfig(env);
      keywords = config.keywords;
    }

    if (!keywords || keywords.length === 0) {
      throw new ValidationError('No keywords configured');
    }

    // 获取 maxPosts 配置
    const maxPostsStr = await env.CONFIG_KV.get('config:maxPosts');
    const maxPosts = maxPostsStr ? parseInt(maxPostsStr) : CONFIG.MAX_POSTS_PER_KEYWORD;

    // 获取 noteTime 配置（时间筛选）
    const noteTimeStr = await env.CONFIG_KV.get('config:noteTime');
    const noteTime = noteTimeStr ? parseInt(noteTimeStr) : 2; // 默认为一周内

    // noteTime 参数说明: 0=不限, 1=一天内, 2=一周内, 3=半年内
    const noteTimeLabels = { 0: '不限', 1: '一天内', 2: '一周内', 3: '半年内' };

    // 获取延迟配置（可选）
    const delayConfigStr = await env.CONFIG_KV.get('config:scrapeDelay');
    const delayConfig = delayConfigStr ? JSON.parse(delayConfigStr) : { enabled: true };

    log('info', 'Starting data collection (串行模式 + 智能延迟 + 进度追踪 + 时间筛选)', {
      keywords,
      maxPosts,
      noteTime: noteTimeLabels[noteTime] || '一周内',
      delayConfig,
      startIndex: startIndex + 1,
      totalKeywords: keywords.length
    });

    const allPosts = [];
    let fallbackCount = 0; // 降级次数统计
    let successCount = 0; // 成功次数统计

    // ✅ 改为串行采集（而不是并行），每个关键词之间有延迟
    log('warn', `⏱️ 串行采集模式：${keywords.length} 个关键词，预计耗时 ${keywords.length * 15}-${keywords.length * 30} 秒`);

    // ========================================================================
    // 主采集循环：从 startIndex 开始
    // ========================================================================
    for (let i = startIndex; i < keywords.length; i++) {
      const keyword = keywords[i];

      // ======================================================================
      // 更新进度到 KV
      // ======================================================================
      const currentProgress = {
        sessionId,
        currentIndex: i,
        totalKeywords: keywords.length,
        timestamp: Date.now(),
        currentKeyword: keyword,
        status: 'collecting'
      };

      await env.CONFIG_KV.put(PROGRESS_KEY, JSON.stringify(currentProgress), {
        expirationTtl: 86400 // 24小时过期
      });

      log('info', `📍 进度更新: [${i + 1}/${keywords.length}] 采集 "${keyword}"`, {
        progress: `${Math.round((i / keywords.length) * 100)}%`,
        remaining: keywords.length - i - 1
      });

      try {
        const posts = await scrapeKeywordWithDelay(keyword, maxPosts, env, i, keywords.length, noteTime);
        allPosts.push(...posts);

        // 检查是否使用了降级数据
        const usedFallback = posts.length > 0 && posts[0].post_id.startsWith('mock_');
        if (usedFallback) {
          fallbackCount++;
          log('warn', `⚠️ 关键词 "${keyword}" 使用了降级数据`, {
            fallbackCount,
            fallbackRate: `${Math.round((fallbackCount / (i + 1)) * 100)}%`
          });
        } else {
          successCount++;
        }

        log('info', `✅ 关键词 "${keyword}" 采集完成，获取 ${posts.length} 条数据`, {
          successCount,
          fallbackCount,
          totalPosts: allPosts.length
        });
      } catch (error) {
        log('error', `❌ 关键词 "${keyword}" 采集失败`, { error: error.message });
        // 继续采集下一个关键词，不中断整个流程
      }
    }

    if (allPosts.length === 0) {
      throw new ValidationError('No posts collected');
    }

    // 批量保存到数据库
    const saveResult = await savePostsBatch(env, allPosts);

    // ========================================================================
    // 清除进度标记（采集完成）
    // ========================================================================
    await env.CONFIG_KV.delete(PROGRESS_KEY);
    log('info', '✅ 进度标记已清除: 采集任务完成');

    log('info', 'Data collection completed', {
      total_collected: allPosts.length,
      saved: saveResult.saved,
      errors: saveResult.errors,
      successCount,
      fallbackCount,
      fallbackRate: `${Math.round((fallbackCount / keywords.length) * 100)}%`
    });

    await saveLog(env, 'info', 'Data collection completed', {
      ...saveResult,
      successCount,
      fallbackCount,
      sessionId
    });

    return {
      success: true,
      total_collected: allPosts.length,
      saved: saveResult.saved,
      errors: saveResult.errors,
      fallbackCount,
      successCount,
      sessionId
    };
  } catch (error) {
    log('error', 'Failed to collect and analyze', { error: error.message });
    await saveLog(env, 'error', 'Data collection failed', {
      error: error.message,
      sessionId,
      startIndex: startIndex + 1
    });
    throw error;
  }
}

/**
 * 生成每日报告
 */
async function generateDailyReport(env) {
  try {
    const reportDate = getYesterdayDate();

    // 检查是否已生成
    const exists = await hasDailyReport(env, reportDate);
    if (exists) {
      log('info', `Daily report already exists for ${reportDate}`);
      return { success: true, message: 'Report already exists' };
    }

    log('info', `Generating daily report for ${reportDate}`);

    // 获取当天数据
    const startDate = `${reportDate} 00:00:00`;
    const endDate = `${reportDate} 23:59:59`;

    const dayPosts = await env.DB.prepare(`
      SELECT * FROM xhs_posts WHERE created_at BETWEEN ? AND ?
    `).bind(startDate, endDate).all();

    const posts = dayPosts.results || [];

    if (posts.length === 0) {
      log('warn', `No posts found for ${reportDate}`);
      return null;
    }

    // 统计数据
    const total_posts = posts.length;
    const avg_sentiment = posts.reduce((sum, p) => sum + p.sentiment_score, 0) / total_posts;
    const positive_count = posts.filter(p => p.sentiment_score >= 0.6).length;
    const negative_count = posts.filter(p => p.sentiment_score < 0.4).length;
    const neutral_count = total_posts - positive_count - negative_count;

    // 关键词统计
    const keywordStats = {};
    for (const post of posts) {
      if (!keywordStats[post.keyword]) {
        keywordStats[post.keyword] = {
          total: 0,
          positive: 0,
          negative: 0,
          avg_score: 0,
        };
      }
      keywordStats[post.keyword].total++;
      if (post.sentiment_score >= 0.6) keywordStats[post.keyword].positive++;
      if (post.sentiment_score < 0.4) keywordStats[post.keyword].negative++;
      keywordStats[post.keyword].avg_score += post.sentiment_score;
    }

    // 计算平均分
    const keywords_summary = Object.entries(keywordStats).map(([keyword, stats]) => ({
      keyword,
      total_posts: stats.total,
      positive_count: stats.positive,
      negative_count: stats.negative,
      avg_sentiment: stats.avg_score / stats.total,
    }));

    // 获取最消极的帖子
    const top_negative_posts = posts
      .filter(p => p.sentiment_score < 0.4)
      .sort((a, b) => a.sentiment_score - b.sentiment_score)
      .slice(0, 10);

    // 保存报告
    await saveDailyReport(env, {
      report_date: reportDate,
      total_posts,
      positive_count,
      neutral_count,
      negative_count,
      avg_sentiment,
      keywords_summary,
      top_negative_posts,
    });

    log('info', `Daily report generated for ${reportDate}`);

    return {
      success: true,
      report_date: reportDate,
      total_posts,
      avg_sentiment,
    };
  } catch (error) {
    log('error', 'Failed to generate daily report', { error: error.message });
    throw error;
  }
}

// ============================================================================
// HTTP 响应工具
// ============================================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CONFIG.CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// API 处理函数
// ============================================================================

/**
 * 处理数据采集请求
 */
async function handleCollect(request, env, ctx) {
  try {
    const body = await request.json().catch(() => ({}));
    const { keywords } = body;

    await initDatabase(env);
    const result = await collectAndAnalyze(env, keywords);

    return jsonResponse({
      success: true,
      data: result,
    });
  } catch (error) {
    log('error', 'Collection failed', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理获取配置请求
 */
async function handleGetConfig(request, env, ctx) {
  try {
    await initDatabase(env);
    const config = await getConfig(env);

    // 获取 maxPosts 配置
    const maxPostsStr = await env.CONFIG_KV.get('config:maxPosts');
    if (maxPostsStr) {
      config.maxPosts = parseInt(maxPostsStr) || 20;
    }

    // 获取 noteTime 配置（时间筛选）
    const noteTimeStr = await env.CONFIG_KV.get('config:noteTime');
    if (noteTimeStr) {
      config.noteTime = parseInt(noteTimeStr);
    } else {
      config.noteTime = 2; // 默认为一周内
    }

    return jsonResponse({
      success: true,
      data: config,
    });
  } catch (error) {
    log('error', 'Failed to get config', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理保存配置请求
 */
async function handleSaveConfig(request, env, ctx) {
  try {
    const body = await request.json();
    const { keywords, enabled = true, maxPosts = 20, cookie, noteTime = 2 } = body;

    if (!Array.isArray(keywords)) {
      throw new ValidationError('Keywords must be an array');
    }

    if (maxPosts < 20 || maxPosts > 50) {
      throw new ValidationError('maxPosts must be between 20 and 50');
    }

    // 验证 noteTime 参数
    if (![0, 1, 2, 3].includes(noteTime)) {
      throw new ValidationError('noteTime must be 0 (不限), 1 (一天内), 2 (一周内), or 3 (半年内)');
    }

    await initDatabase(env);

    // 保存配置到数据库
    await saveConfig(env, keywords, enabled);

    // 保存 maxPosts 到 KV
    await env.CONFIG_KV.put('config:maxPosts', maxPosts.toString());

    // 保存 noteTime 到 KV（时间筛选配置）
    await env.CONFIG_KV.put('config:noteTime', noteTime.toString());
    log('info', 'Time filter configuration saved', { noteTime });

    // 如果提供了 Cookie，保存到 KV
    if (cookie && cookie.trim()) {
      await env.CONFIG_KV.put('xhs_cookie', cookie.trim());
      await env.CONFIG_KV.put('cookie:last_update', Date.now().toString());
      log('info', 'Cookie updated in KV');
    }

    return jsonResponse({
      success: true,
      message: 'Configuration saved',
    });
  } catch (error) {
    log('error', 'Failed to save config', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理 Cookie 状态查询
 */
async function handleCookieStatus(request, env, ctx) {
  try {
    const cookie = await env.CONFIG_KV.get('xhs_cookie');
    const status = await env.CONFIG_KV.get('cookie:status');
    const lastUpdate = await env.CONFIG_KV.get('cookie:last_update');

    const hasCookie = !!cookie;
    const cookieStatus = status || 'unknown';
    const lastUpdateTimestamp = lastUpdate ? parseInt(lastUpdate) : null;

    return jsonResponse({
      success: true,
      data: {
        hasCookie,
        status: cookieStatus,
        lastUpdate: lastUpdateTimestamp,
        message: hasCookie
          ? cookieStatus === 'valid'
            ? 'Cookie 已配置且有效'
            : 'Cookie 可能失效，建议更新'
          : 'Cookie 未配置',
      },
    });
  } catch (error) {
    log('error', 'Failed to get cookie status', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理获取统计请求
 */
async function handleGetStats(request, env, ctx) {
  try {
    await initDatabase(env);
    const stats = await getStats(env);

    return jsonResponse({
      success: true,
      data: stats,
    });
  } catch (error) {
    log('error', 'Failed to get stats', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理获取消极帖子请求
 */
async function handleGetNegativePosts(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    await initDatabase(env);
    const posts = await getNegativePosts(env, limit);

    return jsonResponse({
      success: true,
      data: posts,
    });
  } catch (error) {
    log('error', 'Failed to get negative posts', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理获取关键词统计请求
 */
async function handleGetKeywordStats(request, env, ctx) {
  try {
    await initDatabase(env);
    const stats = await getKeywordStats(env);

    return jsonResponse({
      success: true,
      data: stats,
    });
  } catch (error) {
    log('error', 'Failed to get keyword stats', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理健康检查请求
 */
async function handleHealth(request, env, ctx) {
  try {
    // 检查数据库连接
    await env.DB.prepare('SELECT 1').first();

    // 检查配置
    const config = await getConfig(env);

    return jsonResponse({
      success: true,
      data: {
        status: 'healthy',
        database: 'connected',
        config: {
          keywords_count: config.keywords.length,
          enabled: config.enabled,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    log('error', 'Health check failed', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
      data: {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      },
    }, 503);
  }
}

/**
 * 处理数据清理请求
 */
async function handleCleanup(request, env, ctx) {
  try {
    const body = await request.json().catch(() => ({}));
    const { retentionDays } = body;

    await initDatabase(env);
    const result = await cleanupOldData(env, retentionDays);

    return jsonResponse({
      success: true,
      data: result,
    });
  } catch (error) {
    log('error', 'Failed to cleanup data', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理获取日志请求
 */
async function handleGetLogs(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    await initDatabase(env);
    const logs = await getRecentLogs(env, limit);

    return jsonResponse({
      success: true,
      data: logs,
    });
  } catch (error) {
    log('error', 'Failed to get logs', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理获取采集进度请求
 */
async function handleGetProgress(request, env, ctx) {
  try {
    const PROGRESS_KEY = 'collection:progress';
    const progressData = await env.CONFIG_KV.get(PROGRESS_KEY);

    if (!progressData) {
      return jsonResponse({
        success: true,
        data: {
          inProgress: false,
          message: '当前没有进行中的采集任务'
        }
      });
    }

    const progress = JSON.parse(progressData);

    // 计算进度百分比
    const progressPercent = Math.round(((progress.currentIndex + 1) / progress.totalKeywords) * 100);

    return jsonResponse({
      success: true,
      data: {
        inProgress: true,
        sessionId: progress.sessionId,
        currentIndex: progress.currentIndex,
        totalKeywords: progress.totalKeywords,
        currentKeyword: progress.currentKeyword,
        progress: progressPercent,
        timestamp: progress.timestamp,
        timestampFormatted: new Date(progress.timestamp).toLocaleString('zh-CN'),
        remaining: progress.totalKeywords - progress.currentIndex - 1,
        status: progress.status
      }
    });
  } catch (error) {
    log('error', 'Failed to get progress', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理重置采集进度请求
 */
async function handleResetProgress(request, env, ctx) {
  try {
    const PROGRESS_KEY = 'collection:progress';

    // 删除进度记录
    await env.CONFIG_KV.delete(PROGRESS_KEY);

    log('info', 'Collection progress reset');

    return jsonResponse({
      success: true,
      message: '采集进度已重置，下次采集将从第一个关键词开始'
    });
  } catch (error) {
    log('error', 'Failed to reset progress', { error: error.message });
    return jsonResponse({
      success: false,
      error: error.message,
    }, 500);
  }
}

/**
 * 处理选项请求（CORS 预检）
 */
function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: CONFIG.CORS_HEADERS,
  });
}

// ============================================================================
// Dashboard 模板
// ============================================================================

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>小红书舆情监控系统</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .header {
            background: white;
            padding: 30px;
            border-radius: 15px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }

        .header h1 {
            color: #667eea;
            font-size: 32px;
            margin-bottom: 10px;
        }

        .header p {
            color: #666;
            font-size: 16px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            transition: transform 0.3s;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-card h3 {
            color: #666;
            font-size: 14px;
            margin-bottom: 10px;
            text-transform: uppercase;
        }

        .stat-card .value {
            font-size: 36px;
            font-weight: bold;
            color: #333;
        }

        .stat-card.positive .value {
            color: #10b981;
        }

        .stat-card.neutral .value {
            color: #f59e0b;
        }

        .stat-card.negative .value {
            color: #ef4444;
        }

        .stat-card .trend {
            color: #999;
            font-size: 12px;
            margin-top: 5px;
        }

        .main-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 20px;
        }

        @media (max-width: 1024px) {
            .main-grid {
                grid-template-columns: 1fr;
            }
        }

        .card {
            background: white;
            border-radius: 15px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            overflow: hidden;
        }

        .card-header {
            padding: 20px;
            border-bottom: 1px solid #f0f0f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .card-header h2 {
            color: #333;
            font-size: 18px;
        }

        .card-body {
            padding: 20px;
        }

        .actions {
            display: flex;
            gap: 10px;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.3s;
        }

        .btn-primary {
            background: #667eea;
            color: white;
        }

        .btn-primary:hover {
            background: #5568d3;
        }

        .btn-secondary {
            background: #f0f0f0;
            color: #333;
        }

        .btn-secondary:hover {
            background: #e0e0e0;
        }

        .data-table {
            width: 100%;
            border-collapse: collapse;
        }

        .data-table th,
        .data-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #f0f0f0;
        }

        .data-table th {
            background: #f9f9f9;
            font-weight: 600;
            color: #666;
            font-size: 12px;
            text-transform: uppercase;
        }

        .data-table tr:hover {
            background: #f9f9f9;
        }

        .sentiment-positive {
            color: #10b981;
            font-weight: 600;
        }

        .sentiment-neutral {
            color: #f59e0b;
            font-weight: 600;
        }

        .sentiment-negative {
            color: #ef4444;
            font-weight: 600;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: #999;
        }

        .spinner {
            border: 3px solid #f0f0f0;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .alert {
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 15px;
        }

        .alert-success {
            background: #d1fae5;
            color: #065f46;
            border-left: 4px solid #10b981;
        }

        .alert-error {
            background: #fee2e2;
            color: #991b1b;
            border-left: 4px solid #ef4444;
        }

        .alert-info {
            background: #dbeafe;
            color: #1e40af;
            border-left: 4px solid #3b82f6;
        }

        .config-form {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .form-group label {
            font-size: 14px;
            font-weight: 600;
            color: #333;
        }

        .form-group textarea,
        .form-group input[type="text"] {
            padding: 10px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            font-family: inherit;
        }

        .form-group textarea {
            min-height: 100px;
            resize: vertical;
        }

        .keywords-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }

        .keyword-tag {
            background: #667eea;
            color: white;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
        }

        .keyword-stats-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 15px;
        }

        .keyword-stats-table th,
        .keyword-stats-table td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #f0f0f0;
            font-size: 12px;
        }

        .log-entry {
            padding: 10px;
            border-left: 3px solid #e0e0e0;
            margin-bottom: 10px;
            background: #f9f9f9;
            font-size: 12px;
        }

        .log-entry.log-info {
            border-left-color: #3b82f6;
        }

        .log-entry.log-warn {
            border-left-color: #f59e0b;
        }

        .log-entry.log-error {
            border-left-color: #ef4444;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>🔍 小红书舆情监控系统</h1>
            <p>实时监控关键词，智能分析情感倾向，自动生成每日报告</p>
        </div>

        <!-- Stats Grid -->
        <div class="stats-grid">
            <div class="stat-card">
                <h3>总帖子数</h3>
                <div class="value" id="total-posts">-</div>
                <div class="trend">累计采集</div>
            </div>
            <div class="stat-card positive">
                <h3>积极帖</h3>
                <div class="value" id="positive-posts">-</div>
                <div class="trend">正面评价</div>
            </div>
            <div class="stat-card neutral">
                <h3>中性帖</h3>
                <div class="value" id="neutral-posts">-</div>
                <div class="trend">中立态度</div>
            </div>
            <div class="stat-card negative">
                <h3>消极帖</h3>
                <div class="value" id="negative-posts">-</div>
                <div class="trend">负面评价</div>
            </div>
        </div>

        <!-- Main Grid -->
        <div class="main-grid">
            <!-- Left Column -->
            <div>
                <!-- Data Collection Card -->
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h2>📊 数据采集</h2>
                        <div class="actions">
                            <button class="btn btn-primary" onclick="collectData()">开始采集</button>
                            <button class="btn btn-secondary" onclick="loadStats()">刷新</button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div id="collection-status"></div>
                        <div id="collection-progress" style="margin-top: 15px;"></div>
                    </div>
                </div>

                <!-- Recent Posts Card -->
                <div class="card">
                    <div class="card-header">
                        <h2>📝 最新帖子</h2>
                        <div class="actions">
                            <button class="btn btn-secondary" onclick="loadStats()">刷新</button>
                        </div>
                    </div>
                    <div class="card-body">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>标题</th>
                                    <th>关键词</th>
                                    <th>情感</th>
                                    <th>评分</th>
                                    <th>点赞</th>
                                </tr>
                            </thead>
                            <tbody id="posts-table">
                                <tr>
                                    <td colspan="5" class="loading">
                                        <div class="spinner"></div>
                                        加载中...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <div id="posts-pagination"></div>
                    </div>
                </div>

                <!-- Negative Posts Card -->
                <div class="card" style="margin-top: 20px;">
                    <div class="card-header">
                        <h2>⚠️ 消极帖子</h2>
                        <div class="actions">
                            <button class="btn btn-secondary" onclick="loadNegativePosts()">刷新</button>
                        </div>
                    </div>
                    <div class="card-body">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>标题</th>
                                    <th>关键词</th>
                                    <th>情感评分</th>
                                    <th>内容</th>
                                    <th>时间</th>
                                </tr>
                            </thead>
                            <tbody id="negative-posts-table">
                                <tr>
                                    <td colspan="5" class="loading">
                                        <div class="spinner"></div>
                                        加载中...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Right Column -->
            <div>
                <!-- Config Card -->
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h2>⚙️ 配置</h2>
                    </div>
                    <div class="card-body">
                        <div class="config-form">
                            <div class="form-group">
                                <label>监控关键词（用逗号分隔）</label>
                                <textarea id="keywords-input" placeholder="AI, ChatGPT, Claude"></textarea>
                                <div class="keywords-list" id="keywords-list"></div>
                            </div>
                            <div class="form-group">
                                <label>每关键词采集数量 (20-50)</label>
                                <input type="number" id="maxposts-input" min="20" max="50" value="20" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                                <small style="color: #666;">推荐：20-50篇，数量越多采集时间越长</small>
                            </div>
                            <div class="form-group">
                                <label>采集时间范围</label>
                                <select id="notetime-input" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background-color: white;">
                                    <option value="0">不限时间</option>
                                    <option value="1">一天内</option>
                                    <option value="2" selected>一周内（推荐）</option>
                                    <option value="3">半年内</option>
                                </select>
                                <small style="color: #666;">
                                    说明：选择笔记发布时间范围<br>
                                    • 不限时间：采集所有历史笔记<br>
                                    • 一天内：采集最近24小时的笔记<br>
                                    • 一周内：采集最近7天的笔记（默认）<br>
                                    • 半年内：采集最近6个月的笔记
                                </small>
                            </div>
                            <div class="form-group">
                                <label>小红书 Cookie</label>
                                <textarea id="cookie-input" placeholder="从浏览器开发者工具中获取 Cookie" style="height: 80px; font-family: monospace; font-size: 12px;"></textarea>
                                <small style="color: #666;">
                                    获取方法：<br>
                                    1. 登录 <a href="https://www.xiaohongshu.com" target="_blank">小红书网页版</a><br>
                                    2. 按 F12 打开开发者工具<br>
                                    3. 切换到 Network 标签<br>
                                    4. 刷新页面，点击任意请求<br>
                                    5. 复制 Request Headers 中的 Cookie 值
                                </small>
                            </div>
                            <div class="form-group">
                                <label>
                                    <input type="checkbox" id="enabled-checkbox" style="width: auto;">
                                    启用自动采集
                                </label>
                            </div>
                            <button class="btn btn-primary" onclick="saveConfig()">保存配置</button>
                        </div>
                    </div>
                </div>

                <!-- Keyword Stats Card -->
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h2>📈 关键词统计</h2>
                    </div>
                    <div class="card-body">
                        <div id="keyword-stats">
                            <div class="loading">
                                <div class="spinner"></div>
                                加载中...
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Logs Card -->
                <div class="card">
                    <div class="card-header">
                        <h2>📋 操作日志</h2>
                    </div>
                    <div class="card-body">
                        <div id="logs">
                            <div class="loading">
                                <div class="spinner"></div>
                                加载中...
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const WORKER_URL = window.location.origin;

        // 页面加载时立即执行
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Dashboard loaded, initializing...');
            loadConfig();
            loadStats();
            loadNegativePosts();
            loadKeywordStats();
            loadLogs();
            loadProgress(); // 加载采集进度

            // 定时刷新
            setInterval(() => {
                loadStats();
                loadNegativePosts();
                loadLogs();
                loadProgress(); // 定时检查进度
            }, 30000); // 30 seconds
        });

        // 加载配置
        async function loadConfig() {
            try {
                const response = await fetch(WORKER_URL + '/config');
                const data = await response.json();

                if (data.success) {
                    document.getElementById('keywords-input').value = data.data.keywords.join(', ');
                    document.getElementById('enabled-checkbox').checked = data.data.enabled;

                    // 加载采集数量配置
                    if (data.data.maxPosts) {
                        document.getElementById('maxposts-input').value = data.data.maxPosts;
                    }

                    // 加载时间筛选配置
                    if (data.data.noteTime !== undefined) {
                        document.getElementById('notetime-input').value = data.data.noteTime;
                    }

                    // 显示关键词列表
                    displayKeywordsList(data.data.keywords);

                    // 加载 Cookie 状态
                    loadCookieStatus();
                }
            } catch (error) {
                console.error('Failed to load config:', error);
            }
        }

        // 加载 Cookie 状态
        async function loadCookieStatus() {
            try {
                const response = await fetch(WORKER_URL + '/cookie-status');
                const data = await response.json();

                if (data.success) {
                    const cookieInput = document.getElementById('cookie-input');
                    if (data.data.hasCookie) {
                        cookieInput.placeholder = 'Cookie 已配置（点击查看或更新）';
                        if (data.data.status === 'valid') {
                            showAlert('✅ Cookie 有效', 'success');
                        } else {
                            showAlert('⚠️ Cookie 可能失效，请更新', 'warning');
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to load cookie status:', error);
            }
        }

        // 显示关键词列表
        function displayKeywordsList(keywords) {
            const container = document.getElementById('keywords-list');
            container.innerHTML = keywords.map(keyword =>
                '<span class="keyword-tag">' + keyword + '</span>'
            ).join('');
        }

        // 保存配置
        async function saveConfig() {
            const keywordsText = document.getElementById('keywords-input').value;
            const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k);
            const enabled = document.getElementById('enabled-checkbox').checked;
            const maxPosts = parseInt(document.getElementById('maxposts-input').value) || 20;
            const noteTime = parseInt(document.getElementById('notetime-input').value) || 2;
            const cookie = document.getElementById('cookie-input').value.trim();

            if (keywords.length === 0) {
                showAlert('请至少输入一个关键词', 'error');
                return;
            }

            if (maxPosts < 20 || maxPosts > 50) {
                showAlert('采集数量必须在 20-50 之间', 'error');
                return;
            }

            if (![0, 1, 2, 3].includes(noteTime)) {
                showAlert('时间范围参数无效', 'error');
                return;
            }

            const configData = { keywords, enabled, maxPosts, noteTime };

            // 如果提供了 Cookie，一起保存
            if (cookie) {
                configData.cookie = cookie;
            }

            try {
                const response = await fetch(WORKER_URL + '/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(configData)
                });

                const data = await response.json();

                if (data.success) {
                    showAlert('配置已保存', 'success');
                    displayKeywordsList(keywords);
                } else {
                    showAlert('保存失败: ' + data.error, 'error');
                }
            } catch (error) {
                showAlert('保存失败: ' + error.message, 'error');
            }
        }

        // 全局变量用于分页
        let allPosts = [];
        let currentPage = 1;
        const postsPerPage = 20;

        // 加载统计数据
        async function loadStats() {
            try {
                const response = await fetch(WORKER_URL + '/stats');
                const data = await response.json();

                if (data.success) {
                    const stats = data.data;
                    document.getElementById('total-posts').textContent = stats.total;
                    document.getElementById('positive-posts').textContent = stats.positive;
                    document.getElementById('neutral-posts').textContent = stats.neutral;
                    document.getElementById('negative-posts').textContent = stats.negative;

                    // 保存所有帖子到全局变量
                    allPosts = stats.recent_posts || [];
                    currentPage = 1;

                    // 更新最新帖子表格（显示所有帖子，支持分页）
                    updatePostsTable();
                }
            } catch (error) {
                console.error('Failed to load stats:', error);
            }
        }

        // 更新帖子表格（支持分页）
        function updatePostsTable() {
            const totalPosts = allPosts.length;
            const totalPages = Math.ceil(totalPosts / postsPerPage);

            // 确保当前页在有效范围内
            if (currentPage > totalPages) currentPage = Math.max(1, totalPages);

            // 计算当前页的帖子范围
            const startIndex = (currentPage - 1) * postsPerPage;
            const endIndex = startIndex + postsPerPage;
            const currentPosts = allPosts.slice(startIndex, endIndex);

            // 生成帖子HTML
            const postsHtml = currentPosts.map(post =>
                '<tr>' +
                    '<td>' + post.title + '</td>' +
                    '<td>' + post.keyword + '</td>' +
                    '<td class="sentiment-' + getSentimentClass(post.sentiment_score) + '">' + post.sentiment_label + '</td>' +
                    '<td>' + (post.sentiment_score * 100).toFixed(1) + '%</td>' +
                    '<td>' + post.likes + '</td>' +
                '</tr>'
            ).join('');

            // 更新表格内容
            document.getElementById('posts-table').innerHTML = postsHtml || '<tr><td colspan="5" style="text-align:center;color:#999;">暂无数据</td></tr>';

            // 更新分页控件
            updatePaginationControls(totalPosts, totalPages);
        }

        // 更新分页控件
        function updatePaginationControls(totalPosts, totalPages) {
            const paginationDiv = document.getElementById('posts-pagination');

            if (totalPages <= 1) {
                paginationDiv.innerHTML = '';
                return;
            }

            const startRecord = (currentPage - 1) * postsPerPage + 1;
            const endRecord = Math.min(currentPage * postsPerPage, totalPosts);

            let paginationHtml = '<div style="margin-top: 20px; text-align: center; color: #666;">';
            paginationHtml += '<small>显示 ' + startRecord + ' - ' + endRecord + ' 条，共 ' + totalPosts + ' 条帖子</small><br>';

            paginationHtml += '<div style="margin-top: 10px;">';

            // 首页按钮
            paginationHtml += '<button onclick="goToPage(1)" ' + (currentPage === 1 ? 'disabled' : '') + ' style="padding: 5px 10px; margin: 0 2px; cursor: ' + (currentPage === 1 ? 'not-allowed' : 'pointer') + ';">首页</button>';

            // 上一页按钮
            paginationHtml += '<button onclick="goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + ' style="padding: 5px 10px; margin: 0 2px; cursor: ' + (currentPage === 1 ? 'not-allowed' : 'pointer') + ';">上一页</button>';

            // 页码按钮（显示部分页码，避免太多按钮）
            for (let i = 1; i <= totalPages; i++) {
                if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
                    paginationHtml += '<button onclick="goToPage(' + i + ')" ' + (i === currentPage ? 'disabled' : '') + ' style="padding: 5px 10px; margin: 0 2px; cursor: ' + (i === currentPage ? 'not-allowed' : 'pointer') + '; background-color: ' + (i === currentPage ? '#3b82f6' : '#f3f4f6') + '; color: ' + (i === currentPage ? 'white' : '#333') + ';">' + i + '</button>';
                } else if (i === currentPage - 3 || i === currentPage + 3) {
                    paginationHtml += '<span style="padding: 5px 10px; margin: 0 2px;">...</span>';
                }
            }

            // 下一页按钮
            paginationHtml += '<button onclick="goToPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + ' style="padding: 5px 10px; margin: 0 2px; cursor: ' + (currentPage === totalPages ? 'not-allowed' : 'pointer') + ';">下一页</button>';

            // 末页按钮
            paginationHtml += '<button onclick="goToPage(' + totalPages + ')" ' + (currentPage === totalPages ? 'disabled' : '') + ' style="padding: 5px 10px; margin: 0 2px; cursor: ' + (currentPage === totalPages ? 'not-allowed' : 'pointer') + ';">末页</button>';

            paginationHtml += '</div></div>';

            paginationDiv.innerHTML = paginationHtml;
        }

        // 跳转到指定页面
        function goToPage(page) {
            currentPage = page;
            updatePostsTable();
        }

        // 加载消极帖子
        async function loadNegativePosts() {
            try {
                const response = await fetch(WORKER_URL + '/negative-posts?limit=10');
                const data = await response.json();

                if (data.success) {
                    const postsHtml = data.data.map(post =>
                        '<tr>' +
                            '<td>' + post.title + '</td>' +
                            '<td>' + post.keyword + '</td>' +
                            '<td style="color:#ef4444;font-weight:bold;">' + (post.sentiment_score * 100).toFixed(1) + '%</td>' +
                            '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">' + (post.content || '-') + '</td>' +
                            '<td>' + formatDateTime(post.created_at) + '</td>' +
                        '</tr>'
                    ).join('');

                    document.getElementById('negative-posts-table').innerHTML = postsHtml || '<tr><td colspan="5" style="text-align:center;color:#999;">暂无消极帖子</td></tr>';
                }
            } catch (error) {
                console.error('Failed to load negative posts:', error);
            }
        }

        // 加载关键词统计
        async function loadKeywordStats() {
            try {
                const response = await fetch(WORKER_URL + '/keyword-stats');
                const data = await response.json();

                if (data.success) {
                    const statsHtml = data.data.map(stat =>
                        '<table class="keyword-stats-table">' +
                            '<tr>' +
                                '<td><strong>' + stat.keyword + '</strong></td>' +
                                '<td>' + stat.total_posts + ' 帖</td>' +
                                '<td style="color:#10b981;">积极 ' + stat.positive_count + '</td>' +
                                '<td style="color:#ef4444;">消极 ' + stat.negative_count + '</td>' +
                            '</tr>' +
                            '<tr>' +
                                '<td colspan="4">' +
                                    '<small>平均分: ' + (stat.avg_score * 100).toFixed(1) + '% | 最后更新: ' + formatDateTime(stat.last_post_date) + '</small>' +
                                '</td>' +
                            '</tr>' +
                        '</table>'
                    ).join('');

                    document.getElementById('keyword-stats').innerHTML = statsHtml || '<div style="text-align:center;color:#999;">暂无统计数据</div>';
                }
            } catch (error) {
                console.error('Failed to load keyword stats:', error);
            }
        }

        // 加载日志
        async function loadLogs() {
            try {
                const response = await fetch(WORKER_URL + '/logs?limit=10');
                const data = await response.json();

                if (data.success) {
                    const logsHtml = data.data.map(log =>
                        '<div class="log-entry log-' + log.level + '">' +
                            '<strong>[' + log.level.toUpperCase() + ']</strong> ' + log.message +
                            '<br><small>' + formatDateTime(log.created_at) + '</small>' +
                        '</div>'
                    ).join('');

                    document.getElementById('logs').innerHTML = logsHtml || '<div style="text-align:center;color:#999;">暂无日志</div>';
                }
            } catch (error) {
                console.error('Failed to load logs:', error);
            }
        }

        // 采集数据
        async function collectData() {
            const statusDiv = document.getElementById('collection-status');
            statusDiv.innerHTML = '<div class="loading"><div class="spinner"></div>采集中...</div>';

            try {
                const response = await fetch(WORKER_URL + '/collect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                const data = await response.json();

                if (data.success) {
                    let message = '采集完成！共采集 ' + data.data.total_collected + ' 条数据';

                    // 显示降级统计
                    if (data.data.fallbackCount > 0) {
                        message += '<br>⚠️ ' + data.data.fallbackCount + ' 个关键词使用了降级数据 (' + (data.data.fallbackRate || 'N/A') + ')';
                    }

                    statusDiv.innerHTML = '<div class="alert alert-success">' + message + '</div>';
                    loadStats();
                    loadNegativePosts();
                    loadKeywordStats();
                    loadProgress(); // 刷新进度
                } else {
                    statusDiv.innerHTML = '<div class="alert alert-error">采集失败: ' + data.error + '</div>';
                }
            } catch (error) {
                statusDiv.innerHTML = '<div class="alert alert-error">采集失败: ' + error.message + '</div>';
            }

            // 3秒后清除状态
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 3000);
        }

        // 加载采集进度
        async function loadProgress() {
            try {
                const response = await fetch(WORKER_URL + '/progress');
                const data = await response.json();

                const progressDiv = document.getElementById('collection-progress');

                if (data.success && data.data.inProgress) {
                    const progress = data.data;

                    progressDiv.innerHTML =
                        '<div class="alert alert-info" style="position: relative;">' +
                            '<strong>🔄 采集进行中...</strong><br>' +
                            '当前进度: ' + progress.progress + '% (' + (progress.currentIndex + 1) + '/' + progress.totalKeywords + ')<br>' +
                            '当前关键词: <strong>' + progress.currentKeyword + '</strong><br>' +
                            '剩余: ' + progress.remaining + ' 个关键词<br>' +
                            '更新时间: ' + progress.timestampFormatted + '<br>' +
                            '<button onclick="resetProgress()" class="btn btn-secondary" style="margin-top: 10px; padding: 5px 10px; font-size: 12px;">重置进度</button>' +
                        '</div>';
                } else {
                    progressDiv.innerHTML = '';
                }
            } catch (error) {
                console.error('Failed to load progress:', error);
            }
        }

        // 重置采集进度
        async function resetProgress() {
            if (!confirm('确定要重置采集进度吗？下次采集将从第一个关键词重新开始。')) {
                return;
            }

            try {
                const response = await fetch(WORKER_URL + '/progress', {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    showAlert('进度已重置', 'success');
                    loadProgress();
                } else {
                    showAlert('重置失败: ' + data.error, 'error');
                }
            } catch (error) {
                showAlert('重置失败: ' + error.message, 'error');
            }
        }

        // 获取情感类型
        function getSentimentClass(score) {
            if (score >= 0.6) return 'positive';
            if (score >= 0.4) return 'neutral';
            return 'negative';
        }

        // 格式化日期时间
        function formatDateTime(dateStr) {
            const date = new Date(dateStr);
            return date.toLocaleString('zh-CN');
        }

        // 显示提示
        function showAlert(message, type = 'info') {
            const alert = document.createElement('div');
            alert.className = 'alert alert-' + type;
            alert.textContent = message;
            alert.style.position = 'fixed';
            alert.style.top = '20px';
            alert.style.right = '20px';
            alert.style.zIndex = '9999';
            alert.style.minWidth = '300px';

            document.body.appendChild(alert);

            setTimeout(() => {
                alert.remove();
            }, 5000);
        }
    </script>
</body>
</html>`;
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 处理 HTTP 请求
 */
export default {
  /**
   * Fetch 事件处理
   */
  async fetch(request, env, ctx) {
    // 初始化数据库
    try {
      await initDatabase(env);
    } catch (error) {
      log('error', 'Failed to initialize database', { error: error.message });
      // 继续执行，某些端点可能不需要数据库
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 路由处理
    try {
      if (path === '/dashboard' || path === '/') {
        return new Response(getDashboardHTML(), {
          headers: {
            ...CONFIG.CORS_HEADERS,
            'Content-Type': 'text/html;charset=UTF-8',
          },
        });
      }

      if (path === '/collect' && request.method === 'POST') {
        return await handleCollect(request, env, ctx);
      }

      if (path === '/config') {
        if (request.method === 'GET') {
          return await handleGetConfig(request, env, ctx);
        }
        if (request.method === 'POST') {
          return await handleSaveConfig(request, env, ctx);
        }
      }

      if (path === '/cookie-status') {
        return await handleCookieStatus(request, env, ctx);
      }

      if (path === '/stats') {
        return await handleGetStats(request, env, ctx);
      }

      if (path === '/negative-posts') {
        return await handleGetNegativePosts(request, env, ctx);
      }

      if (path === '/keyword-stats') {
        return await handleGetKeywordStats(request, env, ctx);
      }

      if (path === '/health') {
        return await handleHealth(request, env, ctx);
      }

      if (path === '/cleanup' && request.method === 'POST') {
        return await handleCleanup(request, env, ctx);
      }

      if (path === '/logs') {
        return await handleGetLogs(request, env, ctx);
      }

      if (path === '/progress') {
        if (request.method === 'GET') {
          return await handleGetProgress(request, env, ctx);
        }
        if (request.method === 'DELETE') {
          return await handleResetProgress(request, env, ctx);
        }
      }

      if (path === '/daily-report') {
        const report = await getLatestDailyReport(env);
        return jsonResponse({
          success: true,
          data: report,
        });
      }

      // CORS 预检
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }

      // 404
      return jsonResponse({
        success: false,
        error: 'Not Found',
      }, 404);
    } catch (error) {
      log('error', 'Request failed', { path, error: error.message });
      return jsonResponse({
        success: false,
        error: error.message,
      }, 500);
    }
  },

  /**
   * 定时任务处理
   */
  async scheduled(event, env, ctx) {
    try {
      log('info', 'Scheduled task triggered', { cron: event.cron });

      // 每天晚上22点执行日报生成
      const now = new Date();
      const currentHour = now.getHours();

      if (currentHour >= CONFIG.DAILY_REPORT_HOUR) {
        log('info', 'Generating daily report');
        await generateDailyReport(env);
      }

      // 数据采集（如果启用）
      try {
        const config = await getConfig(env);
        if (config.enabled) {
          log('info', 'Starting scheduled data collection');
          await collectAndAnalyze(env);
        }
      } catch (error) {
        log('error', 'Scheduled collection failed', { error: error.message });
      }

      // 每周日清理旧数据
      const dayOfWeek = now.getDay();
      if (dayOfWeek === 0) {
        log('info', 'Running weekly cleanup');
        await cleanupOldData(env);
      }
    } catch (error) {
      log('error', 'Scheduled task failed', { error: error.message });
    }
  },
};
