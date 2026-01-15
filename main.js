/**
 * Course Monitoring Bot for Thinkific Platform
 * Automated detection and notification system for new course content
 * @author zxtNX
 * @version 0.1.0
 */

require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin()); 
const cheerio = require('cheerio');
const cron = require('node-cron');
const fs = require('fs').promises;
const fsSync = require('fs');

// ==================== CONSTANTS ====================

const CONFIG = {
  WEBHOOK_URL: process.env.DISCORD_WEBHOOK,
  THINKIFIC_EMAIL: process.env.THINKIFIC_EMAIL,
  THINKIFIC_PASSWORD: process.env.THINKIFIC_PASSWORD,
  LOGIN_URL: process.env.COURSE_LOGIN_URL,
  COURSE_URL: process.env.COURSE_CONTENTS_URL,
  COURSE_BASE_URL: process.env.BASE_URL,
  DEFAULT_THUMBNAIL: process.env.DEFAULT_THUMBNAIL,
  DATABASE_FILE: 'database.json',
  COOKIES_FILE: 'cookies.json',
  CRON_SCHEDULE: '0 * * * *', // Every hour
};

const TIMEOUTS = {
  NAVIGATION: 30000,
  SELECTOR_WAIT: 20000,
  TYPING_DELAY: 30,
  NOTIFICATION_DELAY: 2000,
  IMAGE_LOAD_DELAY: 2000,
};

const SELECTORS = {
  EMAIL_INPUT: 'input[name="user[email]"]',
  PASSWORD_INPUT: 'input[name="user[password]"]',
  SUBMIT_BUTTON: 'button[type="submit"]',
  COURSE_ITEM: '.course-player__content-item__link',
  CONTENT_TITLE: '[class*="content-item__title"]',
  CONTENT_DETAILS: '[class*="content-item__details"]',
  JSON_LD_SCRIPT: 'script[type="application/ld+json"]',
};

const EVENT_TYPES = {
  NEW: 'NEW',
  UPDATE: 'UPDATE',
};

const CONTENT_TYPES = {
  VIDEO: '🎥 Vidéo',
  TEXT: '📄 Lecture',
  QUIZ: '❓ Quiz',
  OTHER: 'Autre',
};

const EMBED_COLORS = {
  NEW: 5763719,    // Green
  UPDATE: 16776960, // Yellow
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Validates required environment variables
 * @throws {Error} If required variables are missing
 */
function validateEnvironment() {
  const required = ['DISCORD_WEBHOOK', 'THINKIFIC_EMAIL', 'THINKIFIC_PASSWORD', 'COURSE_LOGIN_URL', 'COURSE_CONTENTS_URL', 'COURSE_BASE_URL', 'DEFAULT_THUMBNAIL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Logs a message with timestamp and level
 * @param {string} level - Log level (INFO, ERROR, WARNING, SUCCESS)
 * @param {string} message - Message to log
 */
function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] - ${message}`);
}

/**
 * Reads JSON file safely
 * @param {string} filepath - Path to JSON file
 * @returns {Object} Parsed JSON or empty object
 */
async function readJSON(filepath) {
  try {
    if (!fsSync.existsSync(filepath)) return {};
    const data = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    log('WARNING', `Failed to read ${filepath}: ${error.message}`);
    return {};
  }
}

/**
 * Writes JSON file safely
 * @param {string} filepath - Path to JSON file
 * @param {Object} data - Data to write
 */
async function writeJSON(filepath, data) {
  try {
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  } catch (error) {
    log('ERROR', `Failed to write ${filepath}: ${error.message}`);
    throw error;
  }
}

/**
 * Sleeps for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==================== AUTHENTICATION ====================

class AuthenticationManager {
  /**
   * Authenticates user and saves session cookies
   * @param {Object} page - Puppeteer page instance
   */
  static async login(page) {
    log('INFO', 'Attempting automatic login...');
    
    try {
      await page.goto(CONFIG.LOGIN_URL, { 
        waitUntil: 'networkidle2',
        timeout: TIMEOUTS.NAVIGATION 
      });
      
      await page.type(SELECTORS.EMAIL_INPUT, CONFIG.THINKIFIC_EMAIL, { 
        delay: TIMEOUTS.TYPING_DELAY 
      });
      await page.type(SELECTORS.PASSWORD_INPUT, CONFIG.THINKIFIC_PASSWORD, { 
        delay: TIMEOUTS.TYPING_DELAY 
      });
      
      await Promise.all([
        page.waitForNavigation({ 
          waitUntil: 'networkidle2',
          timeout: TIMEOUTS.NAVIGATION 
        }),
        page.click(SELECTORS.SUBMIT_BUTTON)
      ]);

      if (page.url().includes('sign_in')) {
        throw new Error('Login failed - check credentials or CAPTCHA presence');
      }

      log('INFO', 'Login successful, saving cookies...');
      const cookies = await page.cookies();
      await writeJSON(CONFIG.COOKIES_FILE, cookies);
      
    } catch (error) {
      log('ERROR', `Login failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Loads saved cookies into page
   * @param {Object} page - Puppeteer page instance
   * @returns {boolean} Whether cookies were loaded
   */
  static async loadCookies(page) {
    try {
      const cookies = await readJSON(CONFIG.COOKIES_FILE);
      if (Object.keys(cookies).length === 0) return false;
      
      await page.setCookie(...cookies);
      log('INFO', 'Cookies loaded from file');
      return true;
    } catch (error) {
      log('WARNING', `Failed to load cookies: ${error.message}`);
      return false;
    }
  }

  /**
   * Checks if current session is valid
   * @param {Object} page - Puppeteer page instance
   * @returns {boolean} Whether session is valid
   */
  static async isSessionValid(page) {
    try {
      await page.goto(CONFIG.COURSE_URL, { 
        waitUntil: 'networkidle2',
        timeout: TIMEOUTS.NAVIGATION 
      });
      return !page.url().includes('sign_in');
    } catch (error) {
      log('WARNING', `Session validation failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Ensures user is authenticated
   * @param {Object} page - Puppeteer page instance
   */
  static async ensureAuthenticated(page) {
    let needsLogin = true;

    // Try loading existing cookies
    const cookiesLoaded = await this.loadCookies(page);
    
    if (cookiesLoaded) {
      const sessionValid = await this.isSessionValid(page);
      if (sessionValid) {
        needsLogin = false;
      } else {
        log('WARNING', 'Session expired, re-authentication required');
      }
    }

    if (needsLogin) {
      await this.login(page);
      await page.goto(CONFIG.COURSE_URL, { 
        waitUntil: 'networkidle2',
        timeout: TIMEOUTS.NAVIGATION 
      });
    }
  }
}

// ==================== CONTENT SCRAPING ====================

class ContentScraper {
  /**
   * Determines content type from element details and URL
   * @param {string} details - Content details text
   * @param {string} url - Content URL
   * @returns {string} Content type
   */
  static identifyContentType(details, url) {
    if (details.includes('Video') || url.includes('/lessons/')) {
      return CONTENT_TYPES.VIDEO;
    }
    if (details.includes('Text') || url.includes('/texts/')) {
      return CONTENT_TYPES.TEXT;
    }
    if (details.includes('Quiz') || url.includes('/quizzes/')) {
      return CONTENT_TYPES.QUIZ;
    }
    return CONTENT_TYPES.OTHER;
  }

  /**
   * Extracts thumbnail from video page
   * @param {Object} page - Puppeteer page instance
   * @param {string} url - Video page URL
   * @returns {string|null} Thumbnail URL or null
   */
  static async extractThumbnail(page, url) {
    try {
      log('INFO', `Fetching thumbnail for: ${url}`);
      await page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: TIMEOUTS.NAVIGATION 
      });
      await sleep(TIMEOUTS.IMAGE_LOAD_DELAY);

      const frames = page.frames();
      for (const frame of frames) {
        const thumbnailUrl = await frame.evaluate(() => {
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (const script of scripts) {
            try {
              const data = JSON.parse(script.innerText);
              if (data.thumbnailUrl) return data.thumbnailUrl;
            } catch (e) {
              // Invalid JSON, continue
            }
          }
          return null;
        });
        
        if (thumbnailUrl) {
          log('INFO', 'Thumbnail found');
          return thumbnailUrl;
        }
      }
      
      log('WARNING', 'No thumbnail found');
      return null;
    } catch (error) {
      log('WARNING', `Failed to extract thumbnail: ${error.message}`);
      return null;
    }
  }

  /**
   * Scrapes all course content from page
   * @param {Object} page - Puppeteer page instance
   * @returns {Array} Array of content items
   */
  static async scrapeContent(page) {
    try {
      await page.waitForSelector(SELECTORS.COURSE_ITEM, { 
        timeout: TIMEOUTS.SELECTOR_WAIT 
      });
    } catch (error) {
      throw new Error('Failed to load course menu');
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const items = [];

    $(SELECTORS.COURSE_ITEM).each((index, element) => {
      const $el = $(element);
      const href = $el.attr('href');
      const match = href ? href.match(/\/(\d+)/) : null;

      if (!match) return;

      const id = match[1];
      const title = $el
        .find(SELECTORS.CONTENT_TITLE)
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .trim() || 'Unknown Title';
      
      const details = $el.find(SELECTORS.CONTENT_DETAILS).text();
      const type = this.identifyContentType(details, href);
      const url = CONFIG.COURSE_BASE_URL + href;

      items.push({ id, title, type, url });
    });

    return items;
  }
}

// ==================== NOTIFICATION SYSTEM ====================

class NotificationService {
  /**
   * Sends Discord webhook notification
   * @param {Object} content - Content data
   * @param {string} eventType - Type of event (NEW or UPDATE)
   */
  static async send(content, eventType = EVENT_TYPES.NEW) {
    const isNew = eventType === EVENT_TYPES.NEW;
    
    const embed = {
      title: isNew 
        ? ':rotating_light: Nouveau contenu disponible !' 
        : ':fire: Du contenu a été mis à jour !',
      description: isNew
        ? `**${content.title}**\nUne nouvelle leçon a été ajoutée sur la plateforme.`
        : `**${content.title}**\nDu contenu a été mis à jour.`,
      url: content.url,
      color: EMBED_COLORS[eventType],
      image: { url: content.image || CONFIG.DEFAULT_THUMBNAIL },
      fields: [
        { name: 'Format', value: content.type, inline: true },
        { name: 'Accès Direct', value: `👉 **[Accéder au Contenu](${content.url})**`, inline: true }
      ],
      footer: { text: 'Go grind ! 🚀' },
      timestamp: new Date().toISOString()
    };

    const payload = {
      username: 'Masterclass Updates',
      embeds: [embed]
    };

    try {
      const response = await fetch(CONFIG.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Discord API returned ${response.status}`);
      }

      log('SUCCESS', `Notification sent (${eventType}): ${content.title}`);
    } catch (error) {
      log('ERROR', `Failed to send notification: ${error.message}`);
      throw error;
    }
  }
}

// ==================== CHANGE DETECTION ====================

class ChangeDetector {
  /**
   * Compares current content with stored database
   * @param {Array} currentItems - Current scraped items
   * @param {Object} database - Stored database
   * @returns {Array} Actions to perform
   */
  static detectChanges(currentItems, database) {
    const actions = [];

    for (const item of currentItems) {
      const stored = database[item.id];

      if (!stored) {
        // New content detected
        actions.push({ type: EVENT_TYPES.NEW, data: item });
      } else if (
        stored.type !== item.type &&
        stored.type === CONTENT_TYPES.TEXT &&
        item.type === CONTENT_TYPES.VIDEO
      ) {
        // Content upgraded from text to video
        actions.push({ type: EVENT_TYPES.UPDATE, data: item });
      }
    }

    return actions;
  }

  /**
   * Updates database with new content
   * @param {Array} items - Current content items
   * @returns {Object} Updated database
   */
  static updateDatabase(items) {
    const database = {};
    for (const item of items) {
      database[item.id] = {
        title: item.title,
        type: item.type
      };
    }
    return database;
  }
}

// ==================== MAIN MONITORING SYSTEM ====================

class CourseMonitor {
  constructor() {
    this.browser = null;
  }

  /**
   * Processes detected actions (notifications)
   * @param {Array} actions - Actions to process
   * @param {Object} page - Puppeteer page instance
   */
  async processActions(actions, page) {
    for (const action of actions) {
      action.data.image = CONFIG.DEFAULT_THUMBNAIL;

      // Fetch thumbnail for video content
      if (action.data.type === CONTENT_TYPES.VIDEO) {
        const thumbnail = await ContentScraper.extractThumbnail(page, action.data.url);
        if (thumbnail) {
          action.data.image = thumbnail;
        }
      }

      await NotificationService.send(action.data, action.type);
      await sleep(TIMEOUTS.NOTIFICATION_DELAY);
    }
  }

  /**
   * Main monitoring check
   */
  async check() {
    log('INFO', `Starting check at ${new Date().toLocaleTimeString()}`);
    
    try {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      const page = await this.browser.newPage();
      
      // Ensure authentication
      await AuthenticationManager.ensureAuthenticated(page);
      
      // Scrape content
      const currentItems = await ContentScraper.scrapeContent(page);
      
      // Load database
      const database = await readJSON(CONFIG.DATABASE_FILE);
      const isFirstRun = Object.keys(database).length === 0;
      
      // Detect changes
      const actions = ChangeDetector.detectChanges(currentItems, database);
      
      // Process actions
      if (actions.length > 0) {
        if (isFirstRun) {
          log('INFO', `Initialization: ${actions.length} courses stored`);
        } else {
          log('INFO', `${actions.length} notifications to process`);
          await this.processActions(actions, page);
        }
        
        const updatedDatabase = ChangeDetector.updateDatabase(currentItems);
        await writeJSON(CONFIG.DATABASE_FILE, updatedDatabase);
        log('SUCCESS', 'Database updated successfully');
      } else {
        log('INFO', 'No changes detected');
      }

    } catch (error) {
      log('ERROR', `Critical error: ${error.message}`);
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  /**
   * Starts the monitoring service
   */
  start() {
    log('INFO', 'Course Monitoring Bot started');
    log('INFO', `Schedule: ${CONFIG.CRON_SCHEDULE}`);
    
    // Run immediately
    this.check();
    
    // Schedule periodic checks
    cron.schedule(CONFIG.CRON_SCHEDULE, () => {
      this.check();
    });
  }
}

// ==================== ENTRY POINT ====================

async function main() {
  try {
    validateEnvironment();
    const monitor = new CourseMonitor();
    monitor.start();
  } catch (error) {
    log('ERROR', `Failed to start bot: ${error.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('INFO', 'Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('INFO', 'Shutting down gracefully...');
  process.exit(0);
});

main();