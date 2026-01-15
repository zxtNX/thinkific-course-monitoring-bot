# Course Monitoring Bot

Automated monitoring and notification system for Thinkific course content updates.
Used to send discord notification through a webhook.

## Features

- 🔐 **Automatic Authentication** - Smart session management with cookie persistence
- 🔍 **Content Detection** - Monitors for new lessons, videos, quizzes, and reading materials
- 🔔 **Discord Notifications** - Real-time alerts via Discord webhooks
- 🖼️ **Thumbnail Extraction** - Automatic thumbnail retrieval for video content
- 📊 **Change Tracking** - Detects both new content and updates to existing content
- ⚡ **Scheduled Checks** - Configurable cron-based monitoring

## Installation

```bash
npm install puppeteer-extra puppeteer-extra-plugin-stealth cheerio node-cron dotenv
```

## Configuration

Create a `.env` file in the project root or rename the `.env.local`:

```env
DISCORD_WEBHOOK=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
THINKIFIC_EMAIL=your.email@example.com
THINKIFIC_PASSWORD=your_password
COURSE_LOGIN_URL=https://MY_COURSE_AUTHOR.thinkific.com/users/sign_in
COURSE_CONTENTS_URL=https://MY_COURSE_AUTHOR.thinkific.com/courses/take/new-course/
COURSE_BASE_URL=https://MY_COURSE_AUTHOR.thinkific.com
DEFAULT_THUMBNAIL=https://HERE_IS_MY_DEFAULT_THUMBNAIL.jpg
```

## Usage

```bash
node main.js
```

The bot will:
1. Run an immediate check on startup
2. Schedule periodic checks (default: every hour)
3. Send Discord notifications through your chosen webhook for any detected changes

## Architecture

### Core Components

#### **AuthenticationManager**
Handles login, session validation, and cookie management.

```javascript
// Ensures user is authenticated before scraping
await AuthenticationManager.ensureAuthenticated(page);
```

#### **ContentScraper**
Scrapes course content and extracts metadata.

```javascript
// Scrape all course items
const items = await ContentScraper.scrapeContent(page);

// Extract video thumbnail
const thumbnail = await ContentScraper.extractThumbnail(page, videoUrl);
```

#### **ChangeDetector**
Compares current content with stored database to identify changes.

```javascript
// Detect new or updated content
const actions = ChangeDetector.detectChanges(currentItems, database);
```

#### **NotificationService**
Sends formatted Discord webhook notifications.

```javascript
// Send notification
await NotificationService.send(content, EVENT_TYPES.NEW);
```

#### **CourseMonitor**
Orchestrates the entire monitoring workflow.

```javascript
const monitor = new CourseMonitor();
monitor.start();
```

## Data Storage

### `cookies.json`
Stores session cookies for authentication persistence.

```json
[
  {
    "name": "_session_id",
    "value": "abc123...",
    "domain": ".thinkific.com"
  }
]
```

### `database.json`
Tracks known content to detect changes.

```json
{
  "12345": {
    "title": "Introduction to Drawing",
    "type": "🎥 Video"
  }
}
```

## Configuration Options

### Timeouts
```javascript
const TIMEOUTS = {
  NAVIGATION: 30000,        // Page navigation timeout
  SELECTOR_WAIT: 20000,     // Wait for selector timeout
  TYPING_DELAY: 30,         // Delay between keystrokes
  NOTIFICATION_DELAY: 2000, // Delay between notifications
  IMAGE_LOAD_DELAY: 2000,   // Wait for images to load
};
```

### Cron Schedule
Default: `'0 * * * *'` (every hour)

Modify `CONFIG.CRON_SCHEDULE` to change frequency:
- `'*/5 * * * *'` - Every 5 minutes
- `'0 * * * *'` - Every hour
- `'0 */2 * * *'` - Every 2 hours
- and so on... If you have no idea how cron syntax works => https://crontab.guru/

## Event Types

### NEW EventType
Triggered when completely new content is detected.

### UPDATE EventType
Triggered when existing content is modified (e.g., content type text become a video type).

## Content Types

- 🎥 **Vidéo** - Video lessons
- 📄 **Lecture** - Text-based content
- ❓ **Quiz** - Interactive quizzes
- **Autre** - Unclassified content

## Error Handling

The bot includes comprehensive error handling:

- **Environment Validation** - Checks required variables on startup
- **Login Failures** - Logs authentication errors with context
- **Session Expiration** - Automatically re-authenticates when needed
- **Scraping Errors** - Graceful degradation if selectors fail
- **Network Issues** - Timeout handling for all network operations

## Logging

Structured logging with timestamps and levels:

```
[2025-01-15T10:30:00.000Z] [INFO] - Starting check at 10:30:00
[2025-01-15T10:30:05.000Z] [SUCCESS] - Notification sent (NEW): Introduction to Perspective
[2025-01-15T10:30:07.000Z] [WARNING] - No thumbnail found
```

## Security Best Practices

- ✅ Environment variables for sensitive data (there are better options if you don't intend to share this and/or willing to not fully automate this kind of task, env variables are never safe to use, specially when they contains your creds)
- ✅ Stealth plugin to avoid detection
- ✅ Graceful shutdown handlers
- ✅ Cookie-based session persistence

## Troubleshooting

### Bot can't login
- Verify credentials in `.env`
- Check if CAPTCHA is present (manual intervention required)
- Review console logs for specific error messages

### No notifications received
- Verify Discord webhook URL is correct
- Ensure network connectivity

### Sessions expire frequently
- Cookies may have short TTL - this is alright
- Bot automatically re-authenticates when needed

## Future Improvements

- [ ] Add retry mechanism for failed requests
- [ ] Implement structured logging with Winston/Pino
- [ ] Add unit tests
- [ ] Support multiple courses
- [ ] Add others apps support for notification options
- [ ] Implement database migrations for schema changes
- [ ] Add health check endpoint
- [ ] Docker containerization

## License

MIT

## Contributing

Pull requests welcome! Please ensure:
- Code follows ESLint standards
- All functions have JSDoc comments
- Error handling is comprehensive
- Changes are backwards compatible
