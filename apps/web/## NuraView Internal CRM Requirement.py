## NuraView Internal CRM Requirement

**Purpose:**
Build an internal CRM for NuraView that collects leads from a Python-based Upwork job scraper and presents them in a clean, actionable way for lead review, prioritization, follow-up, and reminder tracking.

### 1) Lead Ingestion

The CRM must import leads scraped from Upwork jobs and store each lead as a separate record.

Each lead should include:

* Company name, if available
* Lead name / fallback label if company name is unavailable
* Upwork job link
* Extracted date and time
* Source label: `Upwork`
* First name, if identified
* Primary email, if found
* Title / job title, if available
* Lead status
* Reminder data
* Manual review flag / highlighted state

### 2) Lead Display Rules

The lead list should be displayed in a simple, readable format.

Priority display logic:

* If company name exists, show company name prominently.
* If company name does not exist, show the record as a lead entry.
* Leads should be sortable by extraction time in ascending or descending order.
* Newer leads should be able to appear above older leads, so a lead posted 24 minutes ago can appear above one posted 45 minutes ago.

### 3) Filtering and Prioritization

The CRM must include a filter to show only company-based leads.

Filter requirement:

* A toggle or filter option to view only leads with company names.
* This should be treated as a top-priority view for quick review.

### 4) Lead Review and Kanban Handling

The CRM should support a Kanban-style view for lead handling.

In Kanban view:

* A lead can be manually marked as “taken care of” or highlighted.
* This marking should clearly indicate that the lead has already been reviewed.
* The user should be able to click a lead to open its details.

### 5) Lead Detail View

Clicking a lead should open a detailed view containing:

* Company name
* Upwork source link
* First name, if available
* Primary email, if available
* Date and time extracted
* Any other relevant scraped metadata

Fields like title may be included, but the main focus should remain on:

* Company name
* Upwork link
* Extracted timestamp
* Primary email when available

### 6) Reminder System

The CRM must include a reminder feature for follow-up tracking.

Reminder behavior:

* The user should be able to set a reminder from a lead record.
* There should be a `last contacted at` field.
* This field should start empty by default.
* The user can select today’s date or another date manually.
* The CRM should allow setting a reminder after contact.

### 7) Notifications

Reminder notifications should be delivered through WhatsApp push notification.

Notification requirement:

* WhatsApp reminders must be supported.
* The reminder should notify the user at the scheduled time.
* This is a key feature for follow-up and lead conversion.

### 8) Core Workflow

1. Python scraper collects Upwork job leads.
2. Leads are imported into the CRM.
3. CRM displays leads with company name first when available.
4. User filters for company-only leads when needed.
5. User reviews leads in list or Kanban view.
6. User marks leads as handled / highlighted.
7. User opens lead details and sets `last contacted at`.
8. User schedules WhatsApp reminder for follow-up.

### 9) Key Product Intent

The CRM should be intuitive, minimal, and fast for daily lead review. Its main job is to help NuraView quickly identify valuable Upwork leads, prioritize company leads, and keep follow-ups organized through reminders and WhatsApp notifications.

If you want, I can turn this into a cleaner PRD format with sections like **Objectives, User Stories, Functional Requirements, and Acceptance Criteria**.









// python scraper

"""
Upwork Job Scraper Service
FastAPI + Playwright service for scraping Upwork job postings
Replaces Apify in the n8n workflow
"""

import os
import random
import asyncio
import logging
from datetime import datetime
from typing import List, Optional
from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import re
from camoufox.async_api import AsyncCamoufox

# Optional RSS fallback
try:
    import feedparser
except ImportError:
    feedparser = None

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment variables
PROXIES = os.getenv("PROXY_LIST", "").split(",") if os.getenv("PROXY_LIST") else []
USER_AGENTS = os.getenv("USER_AGENTS", "").split(";") if os.getenv("USER_AGENTS") else [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
]
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "2"))
DEFAULT_LIMIT = int(os.getenv("DEFAULT_LIMIT", "25"))
MAX_REQUEST_LIMIT = int(os.getenv("MAX_REQUEST_LIMIT", "50"))
SCRAPE_LOCK_TIMEOUT_SECONDS = int(os.getenv("SCRAPE_LOCK_TIMEOUT_SECONDS", "600"))
HEADLESS = os.getenv("HEADLESS", "true").lower() == "true"

# Concurrency lock - prevents multiple browser instances running simultaneously
import threading
_scrape_lock = threading.Lock()

# Upwork credentials
UPWORK_EMAIL = os.getenv("UPWORK_EMAIL", "admin@auxcgen.com")
UPWORK_PASSWORD = os.getenv("UPWORK_PASSWORD", "h,zT22QNdd!m,+t")
COOKIES_FILE = os.getenv("COOKIES_FILE", "/app/upwork_cookies.json")

def pick_proxy():
    """Select a random proxy from the list"""
    if not PROXIES or PROXIES[0] == "":
        return None
    return random.choice(PROXIES)

def pick_user_agent():
    """Select a random user agent"""
    return random.choice(USER_AGENTS)

async def random_delay(min_sec=1.5, max_sec=3.5):
    """Human-like random delay"""
    delay = random.uniform(min_sec, max_sec)
    logger.info(f"Waiting {delay:.2f} seconds (human-like delay)")
    await asyncio.sleep(delay)

async def load_cookies(context) -> bool:
    """Load cookies from file into browser context (converts Chrome format to Playwright format)"""
    try:
        if os.path.exists(COOKIES_FILE):
            logger.info(f"Loading cookies from {COOKIES_FILE}...")
            with open(COOKIES_FILE, 'r') as f:
                cookies = json.load(f)

            # Convert Chrome cookie format to Playwright format
            playwright_cookies = []
            for cookie in cookies:
                pw_cookie = {
                    'name': cookie['name'],
                    'value': cookie['value'],
                    'domain': cookie['domain'],
                    'path': cookie.get('path', '/'),
                }

                # Convert expiration date
                if 'expirationDate' in cookie and cookie['expirationDate']:
                    pw_cookie['expires'] = int(cookie['expirationDate'])

                # Add optional fields
                if 'httpOnly' in cookie and cookie['httpOnly']:
                    pw_cookie['httpOnly'] = True
                if 'secure' in cookie and cookie['secure']:
                    pw_cookie['secure'] = True

                # Handle sameSite - convert "no_restriction" to "None", null to "Lax"
                same_site = cookie.get('sameSite')
                if same_site == 'no_restriction':
                    pw_cookie['sameSite'] = 'None'
                elif same_site == 'strict':
                    pw_cookie['sameSite'] = 'Strict'
                elif same_site in ['Strict', 'Lax', 'None']:
                    pw_cookie['sameSite'] = same_site
                else:
                    # Default to Lax if null or invalid
                    pw_cookie['sameSite'] = 'Lax'

                playwright_cookies.append(pw_cookie)

            await context.add_cookies(playwright_cookies)
            logger.info(f"✅ Loaded and converted {len(playwright_cookies)} cookies successfully")
            return True
        else:
            logger.warning(f"Cookie file not found: {COOKIES_FILE}")
            return False
    except Exception as e:
        logger.error(f"Error loading cookies: {e}", exc_info=True)
        return False

async def save_cookies(context) -> bool:
    """Save cookies from browser context to file"""
    try:
        cookies = await context.cookies()
        with open(COOKIES_FILE, 'w') as f:
            json.dump(cookies, f, indent=2)
        logger.info(f"Saved {len(cookies)} cookies to {COOKIES_FILE}")
        return True
    except Exception as e:
        logger.error(f"Error saving cookies: {e}")
        return False

async def login_to_upwork(page) -> bool:
    """Login to Upwork with provided credentials - IMPROVED with proper waits"""
    try:
        logger.info("Navigating to Upwork login page...")
        await page.goto("https://www.upwork.com/ab/account-security/login", timeout=60000, wait_until="networkidle")

        # Wait a bit for any initial redirects
        await asyncio.sleep(2)

        # Handle Cloudflare if present
        logger.info("Checking for Cloudflare challenge...")
        for i in range(15):
            cloudflare_frame = None
            for frame in page.frames:
                if 'challenges.cloudflare.com' in frame.url:
                    cloudflare_frame = frame
                    logger.info("Found Cloudflare challenge on login page")
                    break

            if cloudflare_frame:
                try:
                    frame_element = await cloudflare_frame.frame_element()
                    bounding_box = await frame_element.bounding_box()
                    if bounding_box:
                        checkbox_x = bounding_box['x'] + bounding_box['width'] / 9
                        checkbox_y = bounding_box['y'] + bounding_box['height'] / 2
                        await page.mouse.click(x=checkbox_x, y=checkbox_y)
                        logger.info("Clicked Cloudflare checkbox")
                        await asyncio.sleep(3)
                except Exception as e:
                    logger.debug(f"Cloudflare handling: {e}")

            page_title = await page.title()
            if "just a moment" not in page_title.lower():
                logger.info("Cloudflare passed or not present")
                break
            await asyncio.sleep(1)

        # ====== STEP 1: Enter Email ======
        logger.info("Step 1: Waiting for email field...")
        
        # Wait for email input to be visible and ready
        email_selector = 'input[id="login_username"]'
        try:
            await page.wait_for_selector(email_selector, state="visible", timeout=15000)
            logger.info("Email field found and visible")
        except:
            # Try alternative selectors
            logger.warning("Primary email selector failed, trying alternatives...")
            try:
                email_selector = 'input[type="email"]'
                await page.wait_for_selector(email_selector, state="visible", timeout=10000)
            except:
                email_selector = 'input[name="login[username]"]'
                await page.wait_for_selector(email_selector, state="visible", timeout=10000)
        
        # Fill email
        await page.fill(email_selector, UPWORK_EMAIL)
        logger.info(f"Filled email: {UPWORK_EMAIL[:3]}***")
        await asyncio.sleep(1)

        # Press Continue/Next button or Enter
        logger.info("Submitting email...")
        try:
            # Try clicking continue button
            continue_btn_selector = 'button[id="login_password_continue"]'
            await page.wait_for_selector(continue_btn_selector, state="visible", timeout=5000)
            await page.click(continue_btn_selector)
            logger.info("Clicked Continue button")
        except:
            # Fallback to Enter key
            logger.info("Continue button not found, pressing Enter")
            await page.press(email_selector, 'Enter')
        
        await asyncio.sleep(2)

        # ====== DEBUG: Check page state after email submission ======
        current_url_after_email = page.url
        current_title_after_email = await page.title()
        logger.info(f"DEBUG - After email submit: URL={current_url_after_email}")
        logger.info(f"DEBUG - After email submit: Title={current_title_after_email}")
        
        # Save page HTML for debugging
        try:
            page_html = await page.content()
            with open("/tmp/after_email_submit.html", "w") as f:
                f.write(page_html)
            logger.info("DEBUG - Saved page HTML to /tmp/after_email_submit.html")
            
            # Check for common security/verification elements
            if "security" in current_url_after_email.lower():
                logger.warning("🔒 Security verification page detected")
            if "verification" in current_url_after_email.lower():
                logger.warning("🔒 Verification page detected")
            if await page.query_selector('text="Verify it\'s you"'):
                logger.warning("🔒 'Verify it's you' prompt detected")
        except Exception as e:
            logger.debug(f"Debug info collection error: {e}")

        # ====== STEP 2: Enter Password ======
        logger.info("Step 2: Waiting for password field...")
        
        # Wait for password field to appear (it shows after email is submitted)
        password_selector = 'input[id="login_password"]'
        try:
            await page.wait_for_selector(password_selector, state="visible", timeout=15000)
            logger.info("Password field found and visible")
        except:
            # Try alternative selectors
            logger.warning("Primary password selector failed, trying alternatives...")
            try:
                password_selector = 'input[type="password"]'
                await page.wait_for_selector(password_selector, state="visible", timeout=10000)
            except:
                password_selector = 'input[name="login[password]"]'
                await page.wait_for_selector(password_selector, state="visible", timeout=10000)
        
        # Fill password
        await page.fill(password_selector, UPWORK_PASSWORD)
        logger.info("Filled password (hidden)")
        await asyncio.sleep(1)

        # ====== STEP 3: Submit Login ======
        logger.info("Step 3: Submitting login...")
        try:
            # Try clicking login button
            login_btn_selector = 'button[id="login_control_continue"]'
            await page.wait_for_selector(login_btn_selector, state="visible", timeout=5000)
            await page.click(login_btn_selector)
            logger.info("Clicked Login button")
        except:
            # Fallback to Enter key
            logger.info("Login button not found, pressing Enter")
            await page.press(password_selector, 'Enter')
        
        # Wait for navigation after login
        logger.info("Waiting for login to complete...")
        await asyncio.sleep(5)

        # ====== STEP 4: Verify Login Success ======
        current_url = page.url
        page_title = await page.title()
        
        logger.info(f"After login - URL: {current_url}")
        logger.info(f"After login - Title: {page_title}")

        # Check multiple success indicators
        success_indicators = [
            "login" not in current_url.lower(),
            "feed" in current_url.lower() or "home" in current_url.lower(),
            "signin" not in page_title.lower()
        ]
        
        if any(success_indicators):
            logger.info("✅ Login successful!")
            return True
        else:
            # Check if we're on 2FA page
            if "verification" in current_url.lower() or "security" in page_title.lower():
                logger.error("❌ Login requires 2FA/verification - cannot proceed automatically")
                return False
            
            logger.warning(f"⚠️ Login may have failed. URL: {current_url}")
            
            # Try to get error message
            try:
                error_elem = await page.query_selector('[data-test="error-message"]')
                if error_elem:
                    error_text = await error_elem.inner_text()
                    logger.error(f"Login error: {error_text}")
            except:
                pass
            
            return False

    except Exception as e:
        logger.error(f"❌ Error during login: {str(e)}", exc_info=True)
        
        # Save screenshot for debugging
        try:
            screenshot_path = "/tmp/login_error.png"
            await page.screenshot(path=screenshot_path)
            logger.error(f"Saved error screenshot to {screenshot_path}")
        except:
            pass
        
        return False


async def detect_block(page) -> bool:
    """Detect if we've been blocked or hit a captcha"""
    try:
        content = await page.content()
        content_lower = content.lower()

        # Check for common block indicators
        block_indicators = [
            "captcha",
            "access denied",
            "blocked",
            "check you are a human",
            "unusual traffic",
            "verify you are human"
        ]

        for indicator in block_indicators:
            if indicator in content_lower:
                logger.warning(f"Block detected: found '{indicator}' in page content")
                return True

        return False
    except Exception as e:
        logger.error(f"Error detecting block: {str(e)}")
        return False

async def extract_job_from_card(card) -> Optional[dict]:
    """Extract job data from a job card element"""
    try:
        job_data = {}

        # Extract job URL and title - try multiple selectors
        try:
            # Try the most specific selector first
            title_link = await card.query_selector('[data-test="job-tile-title-link"]')

            # Fallback to other selectors if first fails
            if not title_link:
                title_link = await card.query_selector('.job-tile-title a')

            if not title_link:
                title_link = await card.query_selector('h2 a')

            if title_link:
                href = await title_link.get_attribute('href')
                job_data['job_url'] = f"https://www.upwork.com{href}" if href and href.startswith('/') else href
                job_data['url'] = job_data['job_url']  # Keep both for compatibility

                # Extract job_id from URL
                job_id_match = re.search(r'_~(\d+)', job_data['job_url'])
                if job_id_match:
                    job_data['job_id'] = job_id_match.group(1)
                else:
                    job_data['job_id'] = job_data['job_url'].split('/')[-1].replace('?referrer_url_path=', '')

                # Get text content and clean up HTML entities
                title_text = await title_link.inner_text()
                job_data['job_title'] = title_text.strip()
                job_data['title'] = job_data['job_title']  # Keep both for compatibility
                logger.debug(f"Extracted title: {job_data['job_title'][:50]}...")
            else:
                logger.warning("All title link selectors returned None")
                # Debug: print card HTML snippet
                card_html = await card.inner_html()
                logger.debug(f"Card HTML snippet: {card_html[:500]}")
                return None
        except Exception as e:
            logger.error(f"Error extracting title/URL: {e}", exc_info=True)
            return None

        # Extract description (UPDATED SELECTOR)
        try:
            desc_elem = await card.query_selector('.air3-line-clamp p.mb-0.text-body-sm')
            if desc_elem:
                job_data['job_description'] = (await desc_elem.inner_text()).strip()[:2000]
                job_data['description'] = job_data['job_description']  # Keep both for compatibility
            else:
                job_data['job_description'] = ""
                job_data['description'] = ""
        except Exception as e:
            logger.debug(f"Error extracting description: {e}")
            job_data['job_description'] = ""
            job_data['description'] = ""

        # Extract budget/price (UPDATED SELECTOR WITH PARSING)
        try:
            budget_raw = "N/A"
            budget_min = None
            budget_max = None

            # Try fixed price budget
            budget_elem = await card.query_selector('li[data-test="is-fixed-price"] strong:nth-of-type(2)')
            if budget_elem:
                budget_raw = (await budget_elem.inner_text()).strip()
                # Parse fixed price: e.g., "$500" or "$1,000"
                price_match = re.search(r'\$([0-9,]+)', budget_raw)
                if price_match:
                    budget_min = int(price_match.group(1).replace(',', ''))
                    budget_max = budget_min
            else:
                # Try hourly rate: e.g., "$30-$50" or "$25.00-$40.00"
                hourly_elem = await card.query_selector('li[data-test="is-hourly-range"] strong')
                if hourly_elem:
                    budget_raw = (await hourly_elem.inner_text()).strip()
                    # Parse hourly range: e.g., "$30.00-$50.00"
                    range_match = re.search(r'\$([0-9,.]+)\s*-\s*\$([0-9,.]+)', budget_raw)
                    if range_match:
                        budget_min = float(range_match.group(1).replace(',', ''))
                        budget_max = float(range_match.group(2).replace(',', ''))
                    else:
                        # Single hourly rate
                        single_match = re.search(r'\$([0-9,.]+)', budget_raw)
                        if single_match:
                            budget_min = float(single_match.group(1).replace(',', ''))
                            budget_max = budget_min

            job_data['budget_raw'] = budget_raw
            job_data['budget'] = budget_raw  # Keep for compatibility
            job_data['budget_min'] = budget_min
            job_data['budget_max'] = budget_max

        except Exception as e:
            logger.debug(f"Error extracting budget: {e}")
            job_data['budget_raw'] = "N/A"
            job_data['budget'] = "N/A"
            job_data['budget_min'] = None
            job_data['budget_max'] = None

        # Extract client location (from job-tile-info-list or job details)
        try:
            # Location may be in various places - try multiple selectors
            location_elem = await card.query_selector('li[data-test="location"], .job-tile-info-list li:has-text("location")')
            if location_elem:
                job_data['clientLocation'] = (await location_elem.inner_text()).strip()
            else:
                job_data['clientLocation'] = "Not specified"
        except Exception as e:
            logger.debug(f"Error extracting location: {e}")
            job_data['clientLocation'] = "Not specified"

        # Extract posted date (UPDATED SELECTOR)
        try:
            date_elem = await card.query_selector('small[data-test="job-pubilshed-date"] span:nth-of-type(2)')
            if date_elem:
                date_text = (await date_elem.inner_text()).strip()
                job_data['relativeDate'] = date_text
                job_data['posted_at'] = date_text  # For required field
                job_data['absoluteDate'] = datetime.now().isoformat()
            else:
                job_data['relativeDate'] = "Unknown"
                job_data['posted_at'] = "Unknown"
                job_data['absoluteDate'] = datetime.now().isoformat()
        except Exception as e:
            logger.debug(f"Error extracting date: {e}")
            job_data['relativeDate'] = "Unknown"
            job_data['posted_at'] = "Unknown"
            job_data['absoluteDate'] = datetime.now().isoformat()

        # Add metadata fields
        job_data['scraped_at'] = datetime.now().isoformat()
        job_data['scrape_status'] = 'success'  # Will be updated if details fail

        # Initialize optional fields as None (will be extracted from job details page)
        job_data['client_name'] = None
        job_data['client_company'] = None
        job_data['lead_quality_score'] = None  # Will be calculated later

        logger.info(f"Extracted job: {job_data.get('title', 'No title')[:50]}...")
        return job_data

    except Exception as e:
        logger.error(f"Error extracting job from card: {str(e)}")
        return None

async def extract_client_job_history(page) -> list:
    """Extract client's past job history with ratings, feedback, dates, and prices"""
    job_history = []

    try:
        logger.info("Extracting client job history...")

        # CRITICAL: The job history section is COLLAPSED by default! We need to expand it first
        # First, scroll down to load the section (lazy loading)
        logger.info("Scrolling to load client history section...")
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)  # Wait for content to load

        # DEBUG: Save the page HTML to inspect what we're actually getting
        try:
            page_html = await page.content()
            with open("/tmp/job_detail_page.html", "w", encoding="utf-8") as f:
                f.write(page_html)
            logger.info("🔍 DEBUG: Saved full page HTML to /tmp/job_detail_page.html for inspection")
        except Exception as e:
            logger.warning(f"Could not save debug HTML: {e}")

        try:
            # Look for the work history section header/button to expand it
            work_history_section = await page.query_selector('[data-cy="work-history-title"]')
            if work_history_section:
                logger.info("✅ Found work history section, attempting to expand...")
                # Scroll to it to ensure it's visible
                await work_history_section.scroll_into_view_if_needed()
                await asyncio.sleep(0.5)

                # Click parent element or any expand button
                parent = await work_history_section.query_selector('xpath=..')
                if parent:
                    await parent.click()
                    logger.info("Clicked work history section header")
                    await asyncio.sleep(1)  # Wait for expansion

            # Also try clicking the "Jobs in progress" button if it exists
            jobs_in_progress_btn = await page.query_selector('[data-cy="jobs-in-progress-button"]')
            if jobs_in_progress_btn:
                logger.info("Found 'Jobs in progress' button, clicking to expand...")
                await jobs_in_progress_btn.click()
                await asyncio.sleep(0.5)

            # Load limited job history for speed - 3 clicks = ~10-15 jobs
            max_clicks = 3  # Limit to prevent excessive delays (was 30)

            previous_job_count = 0
            for click_attempt in range(max_clicks):
                try:
                    # Count current jobs to detect when no more are loading
                    current_jobs = await page.query_selector_all('section.items.air3-card-section[data-cy="jobs"] div.item[data-cy="job"]')
                    current_count = len(current_jobs) if current_jobs else 0

                    # Try multiple selectors for "View more" button
                    # The button is usually in a footer element at the bottom of the job list
                    view_more = await page.query_selector('footer a:has-text("View more"), footer button:has-text("View more"), section[data-cy="jobs"] footer a, section[data-cy="jobs"] footer button, a:has-text("View more")')

                    if view_more:
                        # Check if it's visible and clickable
                        is_visible = await view_more.is_visible()
                        if is_visible:
                            logger.info(f"Found 'View more' link (click #{click_attempt + 1}), currently showing {current_count} jobs, clicking to load more...")
                            await view_more.scroll_into_view_if_needed()
                            await asyncio.sleep(1)  # Increased wait before click
                            await view_more.click()
                            await asyncio.sleep(3)  # Wait for jobs to load

                            # Scroll down to ensure new jobs and next "View more" button are visible
                            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                            await asyncio.sleep(1)

                            # Check if jobs actually increased
                            if current_count > 0 and current_count == previous_job_count:
                                logger.info(f"Job count didn't increase after click, stopping (stuck at {current_count} jobs)")
                                break
                            previous_job_count = current_count
                        else:
                            logger.info(f"View more button not visible, stopping at {current_count} jobs")
                            break
                    else:
                        logger.info(f"No more 'View more' button found after {click_attempt} clicks, loaded {current_count} jobs total")
                        break
                except Exception as e:
                    logger.warning(f"Error clicking View more button on attempt {click_attempt}: {e}")
                    # Don't break immediately, try one more time
                    await asyncio.sleep(2)
                    if click_attempt > 2:  # Only break after several failures
                        break

            logger.info("Finished expanding job history section")

        except Exception as e:
            logger.debug(f"Could not expand job history section: {e}")

        selectors = [
            'section.items.air3-card-section[data-cy="jobs"] div.item[data-cy="job"]',
            '[data-test="client-past-hires"] [data-cy="job"]',
            '[data-qa="client-job-history"] [data-cy="job"]',
            'section[data-cy="jobs"] [data-cy="job"]',
            '.item[data-cy="job"]',
            'div.item[data-cy="job"]',
        ]

        job_items = []
        matched_selector = None
        for selector in selectors:
            try:
                candidate_items = await page.query_selector_all(selector)
                if candidate_items:
                    job_items = candidate_items
                    matched_selector = selector
                    break
            except Exception as selector_error:
                logger.debug(f"Job history selector failed ({selector}): {selector_error}")

        if not job_items:
            logger.info("No structured client job history section found on this job page")
            return []

        logger.info(f"Found {len(job_items)} past jobs in client history using selector: {matched_selector}")

        # Extract ALL jobs (no limit)
        for idx, job_item in enumerate(job_items):
            try:
                job_data = {}

                # Extract job title and URL - UPDATED to match actual HTML
                # The structure is: .main > span.text-base > a.up-n-link.air3-link.js-job-link
                main_div = await job_item.query_selector('.main')
                if main_div:
                    # Try to find the title link
                    title_link = await main_div.query_selector('span.text-base a.up-n-link.air3-link')
                    if not title_link:
                        # Fallback
                        title_link = await main_div.query_selector('a[data-cy="job-title"]')
                    if not title_link:
                        # Another fallback
                        title_elem = await main_div.query_selector('[data-cy="job-title"]')
                        if title_elem:
                            title_link = await title_elem.query_selector('a')
                        else:
                            # Plain text title
                            title_span = await main_div.query_selector('span[data-cy="job-title"]')
                            if title_span:
                                job_data['title'] = (await title_span.inner_text()).strip()

                    if title_link:
                        job_data['title'] = (await title_link.inner_text()).strip()
                        href = await title_link.get_attribute('href')
                        if href:
                            job_data['job_url'] = f"https://www.upwork.com{href}" if href.startswith('/') else href

                # Extract client rating and feedback - from .main .text-body-sm.mt-2x.mb-2x
                if main_div:
                    feedback_div = await main_div.query_selector('.text-body-sm.mt-2x.mb-2x')
                    if feedback_div:
                        # Check for "No feedback given"
                        feedback_text_full = await feedback_div.inner_text()
                        if "No feedback given" in feedback_text_full:
                            job_data['client_feedback'] = "No feedback given"
                        else:
                            # Extract rating
                            client_rating_elem = await feedback_div.query_selector('.air3-rating')
                            if client_rating_elem:
                                rating_value_elem = await client_rating_elem.query_selector('.air3-rating-value-text')
                                if rating_value_elem:
                                    job_data['client_rating'] = (await rating_value_elem.inner_text()).strip()

                            # Extract client feedback text from air3-truncation span
                            truncation_span = await feedback_div.query_selector('.air3-truncation span[id^="air3-truncation-"]')
                            if truncation_span:
                                feedback_text = (await truncation_span.inner_text()).strip()
                                if feedback_text:
                                    job_data['client_feedback'] = feedback_text

                    # Extract freelancer info - from .main > .text-body-sm (the one that says "To freelancer:")
                    freelancer_divs = await main_div.query_selector_all('.text-body-sm')
                    for div in freelancer_divs:
                        div_text = await div.inner_text()
                        if "To freelancer:" in div_text:
                            # Extract freelancer name
                            freelancer_link = await div.query_selector('a.up-n-link')
                            if freelancer_link:
                                job_data['freelancer_name'] = (await freelancer_link.inner_text()).strip()
                                freelancer_href = await freelancer_link.get_attribute('href')
                                if freelancer_href:
                                    job_data['freelancer_url'] = f"https://www.upwork.com{freelancer_href}" if freelancer_href.startswith('/') else freelancer_href

                            # Extract freelancer rating
                            freelancer_rating_elem = await div.query_selector('.air3-rating-sm')
                            if freelancer_rating_elem:
                                freelancer_rating_value = await freelancer_rating_elem.query_selector('.air3-rating-value-text')
                                if freelancer_rating_value:
                                    job_data['freelancer_rating'] = (await freelancer_rating_value.inner_text()).strip()

                            # Extract freelancer feedback
                            freelancer_feedback_span = await div.query_selector('.air3-truncation span[id^="air3-truncation-"]')
                            if freelancer_feedback_span:
                                freelancer_feedback = (await freelancer_feedback_span.inner_text()).strip()
                                if freelancer_feedback and "No feedback given" not in freelancer_feedback:
                                    job_data['freelancer_feedback'] = freelancer_feedback

                            break  # Found freelancer info, stop looking

                # Extract date range and stats from .stats div
                stats_section = await job_item.query_selector('.stats[data-cy="date"]')
                if stats_section:
                    # Extract date
                    date_div = await stats_section.query_selector('.text-body-sm')
                    if date_div:
                        date_text = (await date_div.inner_text()).strip()
                        job_data['date_range'] = date_text

                    # Extract job type and price from [data-cy="stats"]
                    stats_div = await stats_section.query_selector('[data-cy="stats"]')
                    if stats_div:
                        stats_text = (await stats_div.inner_text()).strip()

                        # Parse job type (Fixed-price or Hourly)
                        if "Fixed-price" in stats_text:
                            job_data['job_type'] = "Fixed-price"
                        elif "@" in stats_text:  # "X hrs @ $Y/hr" format
                            job_data['job_type'] = "Hourly"
                            # Extract hours and hourly rate
                            hours_match = re.search(r'(\d+)\s*hrs?', stats_text)
                            if hours_match:
                                job_data['hours'] = hours_match.group(1)
                            hourly_rate_match = re.search(r'@\s*\$(\d+(?:\.\d{2})?)/hr', stats_text)
                            if hourly_rate_match:
                                job_data['hourly_rate'] = f"${hourly_rate_match.group(1)}"

                        # Extract total billed price (looks for "Billed: $XXX.XX")
                        billed_match = re.search(r'Billed:\s*\$[\d,]+(?:\.\d{2})?', stats_text)
                        if billed_match:
                            job_data['total_billed'] = billed_match.group(0).replace('Billed: ', '')
                        else:
                            # Fallback: any dollar amount
                            price_match = re.search(r'\$[\d,]+(?:\.\d{2})?', stats_text)
                            if price_match:
                                job_data['price'] = price_match.group(0)

                # Add job if we have any meaningful data (title, URL, or rating)
                if job_data.get('title') or job_data.get('job_url') or job_data.get('client_rating'):
                    job_history.append(job_data)
                    logger.debug(f"Extracted job history #{idx+1}: {job_data.get('title', 'No title')[:50]}")
                else:
                    logger.debug(f"Skipping job history #{idx+1}: insufficient data")

            except Exception as e:
                logger.warning(f"Error extracting job history item {idx}: {e}")
                # Still try to continue with other jobs
                continue

        logger.info(f"Successfully extracted {len(job_history)} job history items")
        return job_history

    except Exception as e:
        logger.error(f"Error extracting client job history: {str(e)}", exc_info=True)
        return []

async def scrape_job_details(page, job_url: str) -> dict:
    """Scrape full details from individual job page"""
    try:
        logger.info(f"Fetching full details for: {job_url}")
        await page.goto(job_url, timeout=60000, wait_until="networkidle")
        
        # CRITICAL: Handle Cloudflare challenge
        logger.info("Checking for Cloudflare challenge...")
        await asyncio.sleep(2)
        
        for attempt in range(15):  # Wait up to 15 seconds for Cloudflare
            page_title = await page.title()
            page_url = page.url
            
            if "cloudflare" in page_title.lower() or "einen moment" in page_title.lower() or "just a moment" in page_title.lower():
                logger.info(f"Cloudflare detected on attempt {attempt+1}, waiting...")
                await asyncio.sleep(1)
            else:
                logger.info(f"Cloudflare passed, page title: {page_title}")
                break
        else:
            logger.warning("Cloudflare challenge may not have passed after 15 attempts")
        
        # Wait for job detail page to actually load
        logger.info("Waiting for job detail page content to load...")
        try:
            # Wait for page to settle
            await page.wait_for_load_state("networkidle", timeout=10000)
            logger.info("Page settled after navigation")
        except Exception as e:
            logger.debug(f"Page wait error: {e}")
        
        # DEBUG: Save HTML to see what page we're on
        try:
            page_html = await page.content()
            with open("/tmp/scraped_job_page.html", "w") as f:
                f.write(page_html)
            logger.info("DEBUG: Saved job page HTML to /tmp/scraped_job_page.html")
            
            # Check if we're on the right page
            if "About the client" in page_html:
                logger.info("✅ About the client section found in HTML")
            else:
                logger.warning("❌ About the client section NOT found - may not be on job detail page")
        except Exception as e:
            logger.debug(f"Debug save error: {e}")
        
        await random_delay(1.0, 2.0)

        details = {}

        # Extract deliverables from Description section
        try:
            # Get deliverables list items
            deliverables = []
            deliverable_items = await page.query_selector_all('[data-test="deliverable"] span')
            for item in deliverable_items:
                text = (await item.inner_text()).strip()
                if text:  # Skip empty items
                    deliverables.append(text)
            details['deliverables'] = deliverables if deliverables else []
        except Exception as e:
            logger.debug(f"No deliverables found: {e}")
            details['deliverables'] = []

        # Extract skills
        try:
            skills = []
            skill_elements = await page.query_selector_all('[data-test="skills"] button, .air3-token span')
            for skill_elem in skill_elements[:20]:  # Limit to 20 skills
                skill_text = await skill_elem.inner_text()
                if skill_text and skill_text not in skills:
                    skills.append(skill_text.strip())
            details['skills'] = skills
        except Exception as e:
            logger.debug(f"Error extracting skills: {e}")
            details['skills'] = []

        # Extract proposal questions
        try:
            questions = []
            question_elements = await page.query_selector_all('[data-test="question-item"]')
            for q_elem in question_elements:
                q_text = await q_elem.inner_text()
                questions.append(q_text.strip())
            details['proposal_questions'] = questions
        except Exception as e:
            logger.debug(f"Error extracting questions: {e}")
            details['proposal_questions'] = []

        # Extract client info from About the client section
        try:
            client_info = {}
            about_client_text = ""
            about_client_container = await page.query_selector('[data-test="about-client-container"], .cfe-ui-job-about-client')
            if about_client_container:
                try:
                    about_client_text = (await about_client_container.inner_text()).strip()
                except Exception:
                    about_client_text = ""

            # NOTE: Upwork does NOT show client names on job postings for privacy
            # client_name is intentionally left as None - only client company might be available
            # Do NOT extract freelancer names from job history as client names!

            # Extract client company - may be in organization field (rare, but possible)
            try:
                company_elem = await page.query_selector('[data-qa="client-company"], [data-test="client-company-name"]')
                if company_elem:
                    company_text = await company_elem.inner_text()
                    if company_text and len(company_text) > 0:
                        client_info['client_company'] = company_text.strip()
                        details['client_company'] = company_text.strip()
            except Exception as e:
                logger.debug(f"Error extracting client company: {e}")

            # Payment verified - prefer explicit text (current Upwork UI wording).
            about_client_text_lower = about_client_text.lower()
            if "payment method not verified" in about_client_text_lower:
                client_info['payment_verified'] = False
            elif "payment method verified" in about_client_text_lower:
                client_info['payment_verified'] = True
            else:
                # Fallback for older DOM variants.
                payment_verified_elem = await page.query_selector('[data-test="about-client-container"] .payment-verified, .cfe-ui-job-about-client .payment-verified')
                payment_not_verified_elem = await page.query_selector('[data-test="about-client-container"] .payment-not-verified, .cfe-ui-job-about-client .payment-not-verified')
                if payment_not_verified_elem:
                    client_info['payment_verified'] = False
                elif payment_verified_elem:
                    client_info['payment_verified'] = True
                else:
                    client_info['payment_verified'] = False

            # Rating - get from buyer-rating section
            rating_section = await page.query_selector('[data-testid="buyer-rating"]')
            if rating_section:
                rating_value_elem = await rating_section.query_selector('.air3-rating-value-text')
                if rating_value_elem:
                    client_info['rating'] = (await rating_value_elem.inner_text()).strip()
                # Get review count
                rating_text = await rating_section.inner_text()
                review_match = re.search(r'(\d+\.?\d*?)\s+of\s+(\d+)\s+reviews', rating_text)
                if review_match:
                    client_info['review_count'] = review_match.group(2)

            # Location - from data-qa="client-location"
            location_elem = await page.query_selector('[data-qa="client-location"]')
            if location_elem:
                location_strong = await location_elem.query_selector('strong')
                if location_strong:
                    client_info['location'] = (await location_strong.inner_text()).strip()

            # Jobs posted - from data-qa="client-job-posting-stats"
            jobs_elem = await page.query_selector('[data-qa="client-job-posting-stats"] strong')
            if jobs_elem:
                jobs_text = await jobs_elem.inner_text()
                client_info['jobs_posted'] = jobs_text.strip()
            else:
                # Newer UI often uses plain text like "0% hire rate, 1 open job".
                job_posting_stats_elem = await page.query_selector('[data-qa="client-job-posting-stats"]')
                if job_posting_stats_elem:
                    stats_text = (await job_posting_stats_elem.inner_text()).strip()
                    client_info['job_posting_stats'] = stats_text
                    jobs_posted_match = re.search(r'(\d+)\s+jobs?\s+posted', stats_text, re.IGNORECASE)
                    if jobs_posted_match:
                        client_info['jobs_posted'] = jobs_posted_match.group(1)
                    hire_rate_match = re.search(r'(\d+)%\s+hire\s+rate', stats_text, re.IGNORECASE)
                    if hire_rate_match:
                        client_info['hire_rate'] = hire_rate_match.group(1)
                    open_jobs_match = re.search(r'(\d+)\s+open\s+jobs?', stats_text, re.IGNORECASE)
                    if open_jobs_match:
                        client_info['open_jobs'] = open_jobs_match.group(1)

            # Total spent - from data-qa="client-spend"
            spent_elem = await page.query_selector('[data-qa="client-spend"] strong')
            if spent_elem:
                spent_text = await spent_elem.inner_text()
                client_info['total_spent'] = spent_text.strip()

            member_since_elem = await page.query_selector('[data-qa="client-contract-date"]')
            if member_since_elem:
                member_since_text = (await member_since_elem.inner_text()).strip()
                if member_since_text:
                    client_info['member_since'] = member_since_text

            if not client_info.get('total_spent') and about_client_text:
                total_spent_match = re.search(r'(\$[\d,]+(?:\.\d{1,2})?)\s+total\s+spent', about_client_text, re.IGNORECASE)
                if total_spent_match:
                    client_info['total_spent'] = total_spent_match.group(1)

            if not client_info.get('rating') and about_client_text:
                rating_match = re.search(r'(\d(?:\.\d)?)\s+of\s+(\d+)\s+reviews', about_client_text, re.IGNORECASE)
                if rating_match:
                    client_info['rating'] = rating_match.group(1)
                    client_info['review_count'] = rating_match.group(2)

            # Extract client job history (past jobs with ratings and feedback)
            client_info['job_history'] = await extract_client_job_history(page)
            if about_client_text:
                client_info['about_client_summary'] = about_client_text

            details['client_info'] = client_info
        except Exception as e:
            logger.debug(f"Error extracting client info: {e}")
            details['client_info'] = {}

        # Extract activity
        try:
            activity = {}
            activity_section = await page.query_selector('[data-test="job-activity"]')
            if activity_section:
                activity_text = await activity_section.inner_text()
                details['activity'] = activity_text.strip()
        except Exception as e:
            logger.debug(f"Error extracting activity: {e}")
            details['activity'] = ""

        logger.info(f"Successfully scraped full details")
        return details

    except Exception as e:
        logger.error(f"Error scraping job details: {str(e)}", exc_info=True)
        return {}

async def scrape_upwork_rss(query: str, limit: int = 50) -> List[dict]:
    """
    Scrape Upwork using RSS feed (bypasses Cloudflare)
    """
    logger.info(f"Starting Upwork RSS scrape - Query: '{query}', Limit: {limit}")

    if not feedparser:
        logger.error("feedparser not installed")
        return []

    try:
        # Build RSS URL
        search_query = query.replace(' ', '+')
        rss_url = f"https://www.upwork.com/ab/feed/jobs/rss?q={search_query}&sort=recency"

        logger.info(f"Fetching RSS from: {rss_url}")
        feed = feedparser.parse(rss_url)

        results = []
        entries = feed.entries[:limit]
        logger.info(f"Found {len(entries)} jobs in RSS feed")

        for i, entry in enumerate(entries):
            try:
                # Extract budget from description
                budget = "N/A"
                if hasattr(entry, 'description'):
                    budget_match = re.search(r'\$[\d,]+(?:-\$[\d,]+)?', entry.description)
                    if budget_match:
                        budget = budget_match.group(0)

                job_data = {
                    "url": entry.link if hasattr(entry, 'link') else "",
                    "title": entry.title if hasattr(entry, 'title') else "",
                    "description": entry.summary[:2000] if hasattr(entry, 'summary') else "",
                    "budget": budget,
                    "clientLocation": "Not available in RSS",
                    "relativeDate": entry.published if hasattr(entry, 'published') else "",
                    "absoluteDate": datetime.now().isoformat()
                }

                results.append(job_data)
                logger.info(f"Extracted job {i+1}/{len(entries)}: {job_data['title'][:50]}...")

            except Exception as e:
                logger.error(f"Error extracting RSS entry {i}: {str(e)}")
                continue

        logger.info(f"RSS scraping completed. Total jobs extracted: {len(results)}")
        return results

    except Exception as e:
        logger.error(f"Error fetching RSS feed: {str(e)}")
        return []

async def scrape_upwork_search(query: str, limit: int = 50) -> List[dict]:
    """
    Main scraping function using Camoufox anti-detect browser
    Returns list of job dictionaries matching the Apify format
    """
    logger.info(f"Starting Upwork scrape with Camoufox - Query: '{query}', Limit: {limit}")
    results = []

    # Try with retries and proxy rotation
    for attempt in range(MAX_RETRIES + 1):
        proxy = pick_proxy()

        logger.info(f"Attempt {attempt + 1}/{MAX_RETRIES + 1} - Proxy: {proxy if proxy else 'None'}")

        try:
            # Configure Camoufox with advanced anti-detect settings
            camoufox_config = {
                "headless": HEADLESS,
                "humanize": True,  # Human-like mouse movements and behavior
                "os": ["windows", "macos"],  # Randomize between Windows and macOS
                "locale": ["en-US"],
                "block_images": False,  # Load images for complete page render
                "block_webrtc": True,  # Block WebRTC to prevent IP leaks
            }

            # Add proxy if configured
            if proxy:
                camoufox_config["proxy"] = {"server": proxy}

            logger.info("Launching Camoufox browser with anti-detect configuration...")

            # Launch Camoufox browser
            async with AsyncCamoufox(**camoufox_config) as browser:
                context = await browser.new_context()

                # Try to load cookies for authentication
                cookies_loaded = await load_cookies(context)

                page = await context.new_page()

                # If no cookies, try to login
                if not cookies_loaded:
                    logger.info("No cookies found, attempting login...")
                    login_success = await login_to_upwork(page)
                    if login_success:
                        # Save cookies for future use
                        await save_cookies(context)
                    else:
                        logger.warning("Login failed, continuing without authentication...")
                        login_success = False
                else:
                    logger.info("Cookies loaded, proceeding with authenticated session")
                    login_success = True

                    # CRITICAL: Visit homepage FIRST with cookies to establish the session!
                    logger.info("🔑 Visiting Upwork homepage to establish authenticated session...")
                    await page.goto("https://www.upwork.com/", timeout=60000, wait_until="networkidle")
                    await asyncio.sleep(2)  # Let session establish
                    logger.info("✅ Session established, proceeding to search")

                # Build search URL with correct parameters
                search_query = query.replace(' ', '%20')
                search_url = f"https://www.upwork.com/nx/search/jobs/?nbs=1&per_page=10&q={search_query}&sort=recency"

                logger.info(f"Navigating to: {search_url}")
                await page.goto(search_url, timeout=60000, wait_until="load")

                # Wait for Cloudflare challenge to appear and complete
                logger.info("Waiting for potential Cloudflare challenge...")
                for i in range(15):
                    await asyncio.sleep(1)

                    # Check if Cloudflare iframe is present
                    cloudflare_frame = None
                    for frame in page.frames:
                        if 'challenges.cloudflare.com' in frame.url:
                            cloudflare_frame = frame
                            logger.info(f"Detected Cloudflare challenge frame at iteration {i+1}")
                            break

                    # If Cloudflare challenge iframe found, click the checkbox
                    if cloudflare_frame:
                        try:
                            logger.info("Attempting to click Cloudflare Turnstile checkbox...")
                            frame_element = await cloudflare_frame.frame_element()
                            bounding_box = await frame_element.bounding_box()

                            if bounding_box:
                                # Calculate precise checkbox coordinates
                                coord_x = bounding_box['x']
                                coord_y = bounding_box['y']
                                width = bounding_box['width']
                                height = bounding_box['height']

                                checkbox_x = coord_x + width / 9
                                checkbox_y = coord_y + height / 2

                                # Click the checkbox
                                await page.mouse.click(x=checkbox_x, y=checkbox_y)
                                logger.info("Clicked Cloudflare Turnstile checkbox")

                                # Wait for potential navigation after clicking checkbox
                                try:
                                    await page.wait_for_load_state("networkidle", timeout=5000)
                                    logger.info("Page settled after Cloudflare click")
                                except Exception as nav_err:
                                    logger.debug(f"Navigation wait completed with: {nav_err}")
                                    await asyncio.sleep(2)
                        except Exception as e:
                            logger.warning(f"Error clicking Cloudflare checkbox: {e}")

                    # Check if challenge is complete (handle potential context destruction)
                    try:
                        page_title = await page.title()
                        if "just a moment" not in page_title.lower():
                            logger.info(f"Challenge completed at iteration {i+1}, page title: {page_title}")
                            break
                    except Exception as title_err:
                        # Context may have been destroyed by navigation - that's OK, continue
                        logger.debug(f"Page title check failed (likely due to navigation): {title_err}")
                        await asyncio.sleep(1)

                # Final check: verify page loaded correctly
                try:
                    page_title = await page.title()
                    logger.info(f"Final page title: {page_title}")

                    if "just a moment" in page_title.lower():
                        logger.warning("Cloudflare challenge still present after waiting, retrying...")
                        continue

                    # Check if we're on the correct page (Upwork job search)
                    if "upwork" not in page_title.lower():
                        logger.warning(f"Unexpected page title: {page_title}, retrying...")
                        continue
                except Exception as title_err:
                    logger.warning(f"Could not get page title: {title_err}, continuing anyway...")
                    # Page may have navigated, try to continue anyway
                    await asyncio.sleep(2)

                # DEBUG: Save page HTML to verify bypass
                page_html = await page.content()
                with open('/tmp/camoufox_page.html', 'w', encoding='utf-8') as f:
                    f.write(page_html)
                logger.info("DEBUG: Saved page HTML to /tmp/camoufox_page.html")

                # Additional delay before scraping
                await random_delay(2.0, 4.0)
                
                # Check if we're on the login page (cookies expired/invalid)
                current_url = page.url
                page_title = await page.title()
                if "login" in current_url.lower() or "signin" in page_title.lower():
                    logger.error(f"❌ Redirected to login page - cookies are invalid or expired")
                    logger.error(f"   URL: {current_url}")
                    logger.error(f"   Title: {page_title}")
                    # Clear invalid cookies
                    if os.path.exists(COOKIES_FILE):
                        os.remove(COOKIES_FILE)
                        logger.info("🗑️  Cleared invalid cookies file")
                    # Return empty results - next request will trigger fresh login
                    return []

                # Check what selectors are present
                logger.info("DEBUG: Checking page for job card selectors...")
                all_articles = await page.query_selector_all('article')
                all_job_tiles = await page.query_selector_all('.job-tile')
                all_job_tile_cursor = await page.query_selector_all('.job-tile.cursor-pointer')
                logger.info(f"DEBUG: Found {len(all_articles)} <article> tags")
                logger.info(f"DEBUG: Found {len(all_job_tiles)} .job-tile elements")
                logger.info(f"DEBUG: Found {len(all_job_tile_cursor)} .job-tile.cursor-pointer elements")

                # Wait for job cards to load
                logger.info("Waiting for job cards to load...")
                try:
                    await page.wait_for_selector('.job-tile.cursor-pointer', timeout=30000)
                except Exception as e:
                    logger.warning(f"Timeout waiting for job cards: {e}")
                    # Continue anyway, might still find some content

                # Scroll down to trigger lazy loading of more job cards
                logger.info("Scrolling to load more job cards...")
                for scroll_step in range(5):
                    await page.evaluate("window.scrollBy(0, 800)")
                    await asyncio.sleep(0.8)
                await page.evaluate("window.scrollTo(0, 0)")  # scroll back to top
                await asyncio.sleep(1)

                # Find all job cards
                job_cards = await page.query_selector_all('.job-tile.cursor-pointer')
                logger.info(f"Found {len(job_cards)} job cards on page after scrolling")

                # PHASE 1: Extract ALL basic data from cards across multiple pages
                # Upwork shows ~10 cards per page regardless of per_page param
                # So we paginate to collect up to `limit` jobs
                basic_jobs = []
                JOBS_PER_PAGE = 10
                num_pages = max(1, -(-limit // JOBS_PER_PAGE))  # ceiling division e.g. 25/10 = 3 pages
                logger.info(f"📄 Extracting page 1/{num_pages} ({len(job_cards)} cards found)")

                for card in job_cards:
                    if len(basic_jobs) >= limit:
                        break
                    job_data = await extract_job_from_card(card)
                    if job_data:
                        basic_jobs.append(job_data)

                # Paginate to pages 2, 3, ... to collect remaining jobs
                for page_num in range(2, num_pages + 1):
                    if len(basic_jobs) >= limit:
                        break

                    page_url = f"https://www.upwork.com/nx/search/jobs/?nbs=1&per_page=10&q={search_query}&sort=recency&page={page_num}"
                    logger.info(f"📄 Navigating to page {page_num}/{num_pages}: {page_url}")
                    await page.goto(page_url, timeout=60000, wait_until="load")
                    await asyncio.sleep(3)  # Let page settle (no Cloudflare needed - session already established)

                    # Scroll to trigger lazy load
                    for _ in range(3):
                        await page.evaluate("window.scrollBy(0, 800)")
                        await asyncio.sleep(0.5)
                    await page.evaluate("window.scrollTo(0, 0)")
                    await asyncio.sleep(1)

                    page_cards = await page.query_selector_all('.job-tile.cursor-pointer')
                    logger.info(f"📄 Page {page_num}: found {len(page_cards)} cards")

                    for card in page_cards:
                        if len(basic_jobs) >= limit:
                            break
                        job_data = await extract_job_from_card(card)
                        if job_data:
                            basic_jobs.append(job_data)

                pages_scraped = min(num_pages, max(1, len(basic_jobs) // JOBS_PER_PAGE + 1))
                logger.info(f"✅ Phase 1 complete: extracted basic data from {len(basic_jobs)} cards across {pages_scraped} pages")

                # PHASE 2: Now navigate to each job URL for full details
                # Element handles are no longer needed — page can navigate freely
                for i, job_data in enumerate(basic_jobs):
                    if len(results) >= limit:
                        break

                    job_url = job_data.get('url')
                    if job_url and login_success:
                        logger.info(f"Fetching details {i + 1}/{len(basic_jobs)}: {job_data.get('title', 'Unknown')[:40]}...")
                        full_details = await scrape_job_details(page, job_url)
                        job_data.update(full_details)
                    elif not login_success:
                        logger.debug("Skipping full details (not logged in)")

                    results.append(job_data)
                    await random_delay(0.5, 1.5)

                logger.info(f"Successfully extracted {len(results)} jobs")
                break  # Success, exit retry loop

        except Exception as e:
            logger.error(f"Error during scraping attempt {attempt + 1}: {str(e)}")

            if attempt < MAX_RETRIES:
                logger.info("Retrying with different proxy...")
                await asyncio.sleep(2)
            else:
                logger.error("Max retries reached")

    logger.info(f"Scraping completed. Total jobs extracted: {len(results)}")
    return results

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "upwork-scraper",
        "version": "1.0",
        "timestamp": datetime.now().isoformat(),
        "cookies_present": os.path.exists(COOKIES_FILE)
    }), 200

@app.route('/cookies/save', methods=['POST'])
def save_cookies_endpoint():
    """
    Save Upwork cookies manually
    Expected JSON body: {"cookies": [...cookie objects...]}
    """
    try:
        data = request.get_json()
        if not data or 'cookies' not in data:
            return jsonify({"error": "Missing 'cookies' in request body"}), 400

        cookies = data['cookies']

        with open(COOKIES_FILE, 'w') as f:
            json.dump(cookies, f, indent=2)

        logger.info(f"Manually saved {len(cookies)} cookies to {COOKIES_FILE}")

        return jsonify({
            "success": True,
            "message": f"Saved {len(cookies)} cookies",
            "file": COOKIES_FILE
        }), 200

    except Exception as e:
        logger.error(f"Error saving cookies: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/scrape/search', methods=['POST'])
def scrape_search():
    """
    Main scraping endpoint
    Expected JSON body: {"query": "pitch deck", "limit": 50}
    Returns: List of job objects matching Apify format
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({"error": "No JSON data provided"}), 400

        query = data.get('query', '')
        if not query:
            return jsonify({"error": "Missing 'query' parameter"}), 400

        limit = int(data.get('limit', DEFAULT_LIMIT))
        if limit > MAX_REQUEST_LIMIT:
            logger.warning(
                "Requested limit %s exceeds MAX_REQUEST_LIMIT=%s; clamping.",
                limit,
                MAX_REQUEST_LIMIT,
            )
            limit = MAX_REQUEST_LIMIT

        logger.info(f"=== New scraping request ===")
        logger.info(f"Query: {query}")
        logger.info(f"Limit: {limit}")

        # Concurrency lock - bounded wait to avoid long n8n hangs.
        logger.info(f"⏳ Waiting for scrape lock (query: {query})...")
        acquired = _scrape_lock.acquire(blocking=True, timeout=SCRAPE_LOCK_TIMEOUT_SECONDS)
        if not acquired:
            logger.error(
                "❌ Timed out waiting for scrape lock after %s seconds",
                SCRAPE_LOCK_TIMEOUT_SECONDS,
            )
            return jsonify({"success": False, "query": query, "total": 0, "jobs": [], "error": "Timeout waiting for lock", "timestamp": datetime.now().isoformat()}), 503

        try:
            # Run the async scraping function with Playwright + Stealth
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            results = loop.run_until_complete(scrape_upwork_search(query, limit))
            loop.close()
        finally:
            _scrape_lock.release()

        # Return results in the same format as Apify
        response = {
            "success": True,
            "query": query,
            "total": len(results),
            "jobs": results,
            "timestamp": datetime.now().isoformat()
        }

        logger.info(f"=== Request completed: {len(results)} jobs returned ===")
        return jsonify(response), 200

    except Exception as e:
        logger.error(f"Error in scrape_search endpoint: {str(e)}", exc_info=True)
        return jsonify({
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/scrape/job', methods=['POST'])
def scrape_single_job():
    """Scrape a single job by direct URL"""
    try:
        data = request.get_json()
        job_url = data.get('url')
        
        if not job_url:
            return jsonify({'error': 'URL is required'}), 400
        
        logger.info(f"=== Direct job scrape request for URL: {job_url} ===")
        
        # Run the scraper
        result = asyncio.run(scrape_job_by_url(job_url))
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"Error in job scrape endpoint: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

async def scrape_job_by_url(job_url: str):
    """Scrape a single job by URL - uses search to avoid Cloudflare"""
    try:
        # Extract job ID from URL
        import re
        job_id_match = re.search(r'~(\d+)', job_url)
        if not job_id_match:
            return {'success': False, 'error': 'Could not extract job ID from URL'}
        
        job_id = job_id_match.group(1)
        logger.info(f"Extracted job ID: {job_id}")
        
        # Use the existing scrape function with a specific search
        # Extract a unique phrase from the URL to search for
        url_parts = job_url.split('/')
        job_slug = None
        for part in url_parts:
            if '~' in part and job_id in part:
                # Clean up the slug
                job_slug = part.split('_~')[0] if '_~' in part else part.split('~')[0]
                job_slug = job_slug.replace('span-class-highlight-', '').replace('-span-', ' ')
                break
        
        search_query = job_slug if job_slug else f"job {job_id}"
        logger.info(f"Searching for: {search_query}")
        
        from camoufox.async_api import AsyncCamoufox
        async with AsyncCamoufox(
            headless=HEADLESS,
            humanize=True,
            geoip=True,
            exclude_addons=["uBlock0@raymondhill.net"]
        ) as browser:
            context = await browser.new_context()
            cookies_loaded = await load_cookies(context)
            
            if not cookies_loaded:
                logger.warning("No cookies loaded")
            
            page = await context.new_page()
            
            # Navigate to search page
            search_url = f"https://www.upwork.com/nx/search/jobs/?q={search_query.replace(' ', '%20')}"
            logger.info(f"Navigating to search: {search_url}")
            await page.goto(search_url, timeout=60000, wait_until="networkidle")
            
            # Handle Cloudflare on search page
            await asyncio.sleep(2)
            for attempt in range(10):
                page_title = await page.title()
                if "cloudflare" in page_title.lower() or "moment" in page_title.lower():
                    logger.info(f"Cloudflare on search page, attempt {attempt+1}")
                    await asyncio.sleep(1)
                else:
                    break
            
            # Find the specific job by ID in the search results
            logger.info(f"Looking for job with ID {job_id}")
            job_cards = await page.query_selector_all('article[data-ev-job-uid]')
            
            target_card = None
            for card in job_cards:
                card_id = await card.get_attribute('data-ev-job-uid')
                if card_id and job_id in card_id:
                    target_card = card
                    logger.info(f"Found target job card!")
                    break
            
            if not target_card:
                return {'success': False, 'error': f'Job {job_id} not found in search results'}
            
            # Click the job title to open details
            title_link = await target_card.query_selector('[data-test="job-tile-title-link"]')
            if not title_link:
                title_link = await target_card.query_selector('a')
            
            if title_link:
                logger.info("Clicking job title...")
                await title_link.click()
                await asyncio.sleep(3)
                
                # NOW extract the details - we're on the job page via click, not direct navigation
                job_details = await scrape_job_details(page, job_url)
                
                if job_details:
                    return {'success': True, 'job': job_details}
                else:
                    return {'success': False, 'error': 'Failed to extract details after click'}
            else:
                return {'success': False, 'error': 'Could not find clickable title'}
                
    except Exception as e:
        logger.error(f"Error scraping job by URL: {e}", exc_info=True)
        return {'success': False, 'error': str(e)}

if __name__ == '__main__':
    logger.info("Starting Upwork Scraper Service on port 5007...")
    logger.info(f"Proxies configured: {len(PROXIES)}")
    logger.info(f"User agents configured: {len(USER_AGENTS)}")
    logger.info(f"Max retries: {MAX_RETRIES}")
    logger.info(f"Default limit: {DEFAULT_LIMIT}")
    logger.info(f"Headless mode: {HEADLESS}")

    app.run(host='0.0.0.0', port=5007, debug=False)


the scraper program is already running in a vps docker container with data going to n8n and google sheet which no longer would be needed as we are building the front here in nextjs, i will create a new python scraper docker instancty for this and link it to mu local andd prod vercel for backend data