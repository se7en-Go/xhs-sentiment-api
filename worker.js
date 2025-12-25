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
  ],

  // 中等积极（权重 2.0）
  medium: [
    '好', '棒', '满意', '推荐', '喜欢', '不错', '优秀', '出色',
    '值得', '划算', '实惠', '便宜', '超值', '性价比高', '好用',
    '实用', '方便', '舒适', '美观', '漂亮', '好看', '时尚',
    '高级', '有质感', '精致', '细致', '专业', '靠谱', '放心',
    '开心', '快乐', '惊喜', '感动', '温暖', '贴心', '周到',
    '及时', '有效', '明显', '改善', '提升', '帮助', '解决',
  ],

  // 弱积极（权重 1.0）
  weak: [
    '还行', '可以', '不错', '挺好', '一般', '正常', '合格',
    '能接受', '凑合', '勉强', '还好', '得过且过', '不差',
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
  ],

  // 中等消极（权重 2.0）
  medium: [
    '差', '不好', '失望', '不值', '退货', '退款', '问题',
    '缺陷', '故障', '损坏', '破损', '残次', '次品', '假货',
    '水货', '山寨', '劣质', '粗糙', '简陋', '廉价', '低质',
    '难用', '麻烦', '复杂', '繁琐', '不实用', '无效', '没用',
    '无效', '没作用', '没效果', '一般', '普通', '平庸', '平淡',
    '不满', '不爽', '难受', '痛苦', '煎熬', '折磨', '困扰',
  ],

  // 弱消极（权重 1.0）
  weak: [
    '一般', '普通', '平平', '马马虎虎', '将就', '凑合', '勉强',
    '还行', '可以', '不推荐', '不建议', '算了', '算了算了',
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
    const totalResult = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM xhs_posts
    `).first();

    const sentimentResult = await env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(sentiment_score) as avg_score,
        SUM(CASE WHEN sentiment_score >= 0.6 THEN 1 ELSE 0 END) as positive,
        SUM(CASE WHEN sentiment_score < 0.4 THEN 1 ELSE 0 END) as negative
      FROM xhs_posts
    `).first();

    const recentPosts = await env.DB.prepare(`
      SELECT * FROM xhs_posts
      ORDER BY created_at DESC
      LIMIT 50
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
 * 真实采集小红书数据 - 通过 Render API
 */
async function scrapeXHSData(keyword, maxPosts, env) {
  log('info', `Starting to scrape data for keyword: ${keyword}, maxPosts: ${maxPosts}`);

  try {
    // 1. 调用 Render API 进行数据采集
    const renderApiUrl = 'https://xhs-sentiment-api.onrender.com/search';

    log('info', 'Calling Render API', {
      keyword,
      maxPosts,
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
        sort_type: 'general'
      }),
      signal: AbortSignal.timeout(60000) // 60秒超时
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

    // 3. 转换数据格式（如果需要）
    const formattedPosts = posts.map(post => ({
      post_id: post.post_id,
      title: post.title,
      content: post.content,
      author: post.author,
      url: post.url,
      keyword: post.keyword || keyword,
      sentiment_score: post.sentiment_score,
      sentiment_label: post.sentiment_label,
      likes: post.likes,
      created_at: post.created_at || new Date().toISOString()
    }));

    log('info', `Successfully scraped ${formattedPosts.length} posts for keyword: ${keyword}`);
    return formattedPosts;

  } catch (error) {
    log('error', `Failed to scrape keyword: ${keyword}`, { error: error.message });
    throw error;
  }
}

/**
 * 采集和分析数据
 */
async function collectAndAnalyze(env, keywords = null) {
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

    log('info', 'Starting data collection', { keywords, maxPosts });

    const allPosts = [];

    // 并行采集所有关键词的数据
    const scrapePromises = keywords.map(keyword =>
      scrapeXHSData(keyword, maxPosts, env)
    );

    const results = await Promise.allSettled(scrapePromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allPosts.push(...result.value);
      } else {
        log('error', 'Failed to scrape keyword', { error: result.reason });
      }
    }

    if (allPosts.length === 0) {
      throw new ValidationError('No posts collected');
    }

    // 批量保存到数据库
    const saveResult = await savePostsBatch(env, allPosts);

    log('info', 'Data collection completed', {
      total_collected: allPosts.length,
      saved: saveResult.saved,
      errors: saveResult.errors,
    });

    await saveLog(env, 'info', 'Data collection completed', saveResult);

    return {
      success: true,
      total_collected: allPosts.length,
      saved: saveResult.saved,
      errors: saveResult.errors,
    };
  } catch (error) {
    log('error', 'Failed to collect and analyze', { error: error.message });
    await saveLog(env, 'error', 'Data collection failed', { error: error.message });
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
    const { keywords, enabled = true, maxPosts = 20, cookie } = body;

    if (!Array.isArray(keywords)) {
      throw new ValidationError('Keywords must be an array');
    }

    if (maxPosts < 20 || maxPosts > 50) {
      throw new ValidationError('maxPosts must be between 20 and 50');
    }

    await initDatabase(env);

    // 保存配置到数据库
    await saveConfig(env, keywords, enabled);

    // 保存 maxPosts 到 KV
    await env.CONFIG_KV.put('config:maxPosts', maxPosts.toString());

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

            // 定时刷新
            setInterval(() => {
                loadStats();
                loadNegativePosts();
                loadLogs();
            }, CONFIG.REFRESH_INTERVAL);
        });

        // 加载配置
        async function loadConfig() {
            try {
                const response = await fetch(\`\${WORKER_URL}/config\`);
                const data = await response.json();

                if (data.success) {
                    document.getElementById('keywords-input').value = data.data.keywords.join(', ');
                    document.getElementById('enabled-checkbox').checked = data.data.enabled;

                    // 加载采集数量配置
                    if (data.data.maxPosts) {
                        document.getElementById('maxposts-input').value = data.data.maxPosts;
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
                const response = await fetch(\`\${WORKER_URL}/cookie-status\`);
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
                \`<span class="keyword-tag">\${keyword}</span>\`
            ).join('');
        }

        // 保存配置
        async function saveConfig() {
            const keywordsText = document.getElementById('keywords-input').value;
            const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k);
            const enabled = document.getElementById('enabled-checkbox').checked;
            const maxPosts = parseInt(document.getElementById('maxposts-input').value) || 20;
            const cookie = document.getElementById('cookie-input').value.trim();

            if (keywords.length === 0) {
                showAlert('请至少输入一个关键词', 'error');
                return;
            }

            if (maxPosts < 20 || maxPosts > 50) {
                showAlert('采集数量必须在 20-50 之间', 'error');
                return;
            }

            const configData = { keywords, enabled, maxPosts };

            // 如果提供了 Cookie，一起保存
            if (cookie) {
                configData.cookie = cookie;
            }

            try {
                const response = await fetch(\`\${WORKER_URL}/config\`, {
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

        // 加载统计数据
        async function loadStats() {
            try {
                const response = await fetch(\`\${WORKER_URL}/stats\`);
                const data = await response.json();

                if (data.success) {
                    const stats = data.data;
                    document.getElementById('total-posts').textContent = stats.total;
                    document.getElementById('positive-posts').textContent = stats.positive;
                    document.getElementById('neutral-posts').textContent = stats.neutral;
                    document.getElementById('negative-posts').textContent = stats.negative;

                    // 更新最新帖子表格
                    const postsHtml = stats.recent_posts.slice(0, 10).map(post => \`
                        <tr>
                            <td>\${post.title}</td>
                            <td>\${post.keyword}</td>
                            <td class="sentiment-\${getSentimentClass(post.sentiment_score)}">\${post.sentiment_label}</td>
                            <td>\${(post.sentiment_score * 100).toFixed(1)}%</td>
                            <td>\${post.likes}</td>
                        </tr>
                    \`).join('');

                    document.getElementById('posts-table').innerHTML = postsHtml || '<tr><td colspan="5" style="text-align:center;color:#999;">暂无数据</td></tr>';
                }
            } catch (error) {
                console.error('Failed to load stats:', error);
            }
        }

        // 加载消极帖子
        async function loadNegativePosts() {
            try {
                const response = await fetch(\`\${WORKER_URL}/negative-posts?limit=10\`);
                const data = await response.json();

                if (data.success) {
                    const postsHtml = data.data.map(post => \`
                        <tr>
                            <td>\${post.title}</td>
                            <td>\${post.keyword}</td>
                            <td style="color:#ef4444;font-weight:bold;">\${(post.sentiment_score * 100).toFixed(1)}%</td>
                            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;">\${post.content || '-'}</td>
                            <td>\${formatDateTime(post.created_at)}</td>
                        </tr>
                    \`).join('');

                    document.getElementById('negative-posts-table').innerHTML = postsHtml || '<tr><td colspan="5" style="text-align:center;color:#999;">暂无消极帖子</td></tr>';
                }
            } catch (error) {
                console.error('Failed to load negative posts:', error);
            }
        }

        // 加载关键词统计
        async function loadKeywordStats() {
            try {
                const response = await fetch(\`\${WORKER_URL}/keyword-stats\`);
                const data = await response.json();

                if (data.success) {
                    const statsHtml = data.data.map(stat => \`
                        <table class="keyword-stats-table">
                            <tr>
                                <td><strong>\${stat.keyword}</strong></td>
                                <td>\${stat.total_posts} 帖</td>
                                <td style="color:#10b981;">积极 \${stat.positive_count}</td>
                                <td style="color:#ef4444;">消极 \${stat.negative_count}</td>
                            </tr>
                            <tr>
                                <td colspan="4">
                                    <small>平均分: \${(stat.avg_score * 100).toFixed(1)}% | 最后更新: \${formatDateTime(stat.last_post_date)}</small>
                                </td>
                            </tr>
                        </table>
                    \`).join('');

                    document.getElementById('keyword-stats').innerHTML = statsHtml || '<div style="text-align:center;color:#999;">暂无统计数据</div>';
                }
            } catch (error) {
                console.error('Failed to load keyword stats:', error);
            }
        }

        // 加载日志
        async function loadLogs() {
            try {
                const response = await fetch(\`\${WORKER_URL}/logs?limit=10\`);
                const data = await response.json();

                if (data.success) {
                    const logsHtml = data.data.map(log => \`
                        <div class="log-entry log-\${log.level}">
                            <strong>[\${log.level.toUpperCase()}]</strong> \${log.message}
                            <br><small>\${formatDateTime(log.created_at)}</small>
                        </div>
                    \`).join('');

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
                const response = await fetch(\`\${WORKER_URL}/collect\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                const data = await response.json();

                if (data.success) {
                    statusDiv.innerHTML = \`<div class="alert alert-success">采集完成！共采集 \${data.data.total_collected} 条数据</div>\`;
                    loadStats();
                    loadNegativePosts();
                    loadKeywordStats();
                } else {
                    statusDiv.innerHTML = \`<div class="alert alert-error">采集失败: \${data.error}</div>\`;
                }
            } catch (error) {
                statusDiv.innerHTML = \`<div class="alert alert-error">采集失败: \${error.message}</div>\`;
            }

            // 3秒后清除状态
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 3000);
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
            alert.className = \`alert alert-\${type}\`;
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
