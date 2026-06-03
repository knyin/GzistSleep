const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ==================== 配置读取（环境变量） ====================
const SIGNIN_URL = process.env.QL_SIGNIN_URL || '';
const PORTAL_URL = 'https://portal.gzist.edu.cn';
const LONGITUDE = 113.45535269932499;
const LATITUDE = 23.257592994607002;

// 收集所有账号
function getAccounts() {
  const accounts = [];

  // 第一个账号：QL_USERNAME + QL_PASSWORD
  if (process.env.QL_USERNAME && process.env.QL_PASSWORD) {
    accounts.push({
      username: process.env.QL_USERNAME,
      password: process.env.QL_PASSWORD
    });
  }

  // 更多账号：QL_USERNAME_2 + QL_PASSWORD_2, QL_USERNAME_3 + QL_PASSWORD_3, ...
  let idx = 2;
  while (process.env[`QL_USERNAME_${idx}`] && process.env[`QL_PASSWORD_${idx}`]) {
    accounts.push({
      username: process.env[`QL_USERNAME_${idx}`],
      password: process.env[`QL_PASSWORD_${idx}`]
    });
    idx++;
  }

  return accounts;
}

const ACCOUNTS = getAccounts();

// 调试：打印环境变量
console.log('当前环境中的 QL_ 变量:');
Object.keys(process.env).filter(k => k.startsWith('QL_')).forEach(k => {
  const val = process.env[k];
  console.log(`  ${k}=${k.toLowerCase().includes('pass') ? '***' : val}`);
});

if (ACCOUNTS.length === 0 || !SIGNIN_URL) {
  console.log('错误：缺少必要的环境变量');
  console.log('');
  console.log('必填:');
  console.log('  QL_USERNAME    - 第一个账号');
  console.log('  QL_PASSWORD    - 第一个密码');
  console.log('  QL_SIGNIN_URL  - 签到页面URL');
  console.log('');
  console.log('多账号（可选，从 2 开始编号）:');
  console.log('  QL_USERNAME_2  - 第二个账号');
  console.log('  QL_PASSWORD_2  - 第二个密码');
  console.log('  QL_USERNAME_3  - 第三个账号');
  console.log('  QL_PASSWORD_3  - 第三个密码');
  process.exit(1);
}

// ==================== 验证码识别（Python ddddocr） ====================
async function recognizeCaptcha(imageBuffer) {
  const scriptPath = path.join(__dirname, 'ocr_helper.py');
  const base64Data = imageBuffer.toString('base64');

  const pythonCmd = await findPython();

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCmd, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => { proc.kill(); reject(new Error('OCR超时')); }, 15000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`OCR退出码: ${code}, stderr: ${stderr.trim().slice(-100)}`));
        return;
      }
      const lines = stdout.trim().split('\n').filter(l => l);
      const lastLine = lines[lines.length - 1];
      if (!lastLine || lastLine.startsWith('ERROR: ')) {
        reject(new Error(lastLine || 'OCR未识别出结果'));
        return;
      }
      resolve(solveMathCaptcha(lastLine));
    });
    proc.on('error', reject);
    proc.stdin.write(base64Data + '\n');
    proc.stdin.end();
  });
}

async function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(cmd, ['-c', 'import ddddocr; print("ok")'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout.on('data', d => out += d.toString());
        proc.on('close', (code) => code === 0 && out.includes('ok') ? resolve() : reject());
        proc.on('error', reject);
      });
      return cmd;
    } catch {}
  }
  throw new Error('未找到 Python ddddocr，请先安装: pip install ddddocr');
}

function solveMathCaptcha(text) {
  const cleaned = text.replace(/[=xX×]/g, '*').replace(/[oO]/g, '0').replace(/l/g, '1').replace(/[−—–-]/g, '-').replace(/\s/g, '');
  const match = cleaned.match(/(\d+)\s*([+\-*])\s*(\d+)/);
  if (match) {
    const a = parseInt(match[1]), op = match[2], b = parseInt(match[3]);
    let result;
    switch (op) { case '+': result = a + b; break; case '-': result = a - b; break; case '*': result = a * b; break; }
    if (result !== undefined && result >= 0) {
      console.log(`验证码: ${a} ${op} ${b} = ${result}`);
      return String(result);
    }
  }
  return text;
}

// ==================== 浏览器管理 ====================
async function createBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--deny-permission-prompts',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    geolocation: { longitude: LONGITUDE, latitude: LATITUDE },
    permissions: ['geolocation']
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
  });

  return { browser, page };
}

// ==================== 登录门户 ====================
async function loginPortal(page, account) {
  console.log('正在打开门户页面...');
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('门户页面已加载');

  await page.waitForTimeout(2000);

  await page.fill('#userName', account.username);
  console.log('已输入账号');
  await page.fill('#password', account.password);
  console.log('已输入密码');

  for (let i = 0; i < 10; i++) {
    const captchaEl = await page.$('img[src*="base64"]');
    if (!captchaEl) { console.log('无需验证码，直接提交'); break; }

    const src = await captchaEl.getAttribute('src');
    const b64 = src.replace(/^data:image\/\w+;base64,/, '');
    const text = await recognizeCaptcha(Buffer.from(b64, 'base64'));
    console.log(`验证码识别结果: ${text}`);

    await page.fill('#captcha', text);
    await page.click('button.ant-btn-primary');
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('lyappCenter') || (!url.includes('login') && !url.includes('ids'))) {
      console.log('登录成功');
      return;
    }

    const body = await page.textContent('body');
    if (body.includes('密码错误') || body.includes('验证码错误')) {
      console.log(`登录失败（第 ${i + 1} 次重试）`);
      continue;
    }
  }
}

// ==================== 签到 ====================
async function doSignin(page, signinUrl) {
  console.log('正在跳转到签到页面...');
  await page.goto(signinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    const url = page.url();
    if (url.includes('xsfw.gzist') || url.includes('swmzncqapp')) {
      console.log('签到页面已加载');
      break;
    }
  }

  await page.waitForTimeout(3000);
  const bodyText = await page.textContent('body');

  if (bodyText.includes('已签到') || bodyText.includes('今日已签到')) {
    console.log('今日已签到，无需重复签到');
    return { success: true, message: '已签到' };
  }

  if (bodyText.includes('非考勤时段')) {
    console.log('当前非考勤时段，无法签到');
    return { success: false, message: '非考勤时段' };
  }

  const selectors = ['a.erweima-bksy', '.qrcode_scan', 'a:has-text("点击签到")', 'button:has-text("签到")', '[class*="sign"]'];
  for (let i = 0; i < 15; i++) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          const text = await el.textContent();
          console.log(`点击签到: ${(text || '').trim()}`);
          await el.click();
          await page.waitForTimeout(3000);

          const resultText = await page.textContent('body');
          if (resultText.includes('签到成功') || resultText.includes('已签到') || resultText.includes('登记成功')) {
            console.log('签到成功！');
            return { success: true, message: '签到成功' };
          }
          return { success: true, message: '签到操作已执行' };
        }
      } catch {}
    }

    const allBtns = await page.$$('button, a');
    for (const btn of allBtns) {
      try {
        const text = (await btn.textContent()).trim();
        if (text.includes('签到') || text.includes('打卡') || text.includes('登记')) {
          console.log(`点击: ${text.substring(0, 20)}`);
          await btn.click();
          await page.waitForTimeout(3000);
          return { success: true, message: '签到操作已执行' };
        }
      } catch {}
    }
    await page.waitForTimeout(1000);
  }

  throw new Error('未找到签到按钮');
}

// ==================== 主流程 ====================
async function main() {
  console.log(`=== 厂州理工学院自动签到 ===`);
  console.log(`共 ${ACCOUNTS.length} 个账号，签到URL已配置`);
  console.log(`定位: ${LONGITUDE}, ${LATITUDE}\n`);

  let browser;
  try {
    console.log('正在启动浏览器...');
    const result = await createBrowser();
    browser = result.browser;
    const page = result.page;
    console.log('浏览器启动成功\n');

    for (let i = 0; i < ACCOUNTS.length; i++) {
      const acc = ACCOUNTS[i];
      const tag = ACCOUNTS.length > 1 ? `[账号 ${i + 1}/${ACCOUNTS.length}: ${acc.username}] ` : '';

      console.log(`${tag}--- 开始 ---`);

      // 清除上一账号的登录状态（cookies、缓存），确保重新登录
      await page.context().clearCookies();
      // 清空 localStorage/sessionStorage（需要先导航到一个同源页面才能操作）
      try {
        await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      } catch {}
      console.log(`${tag}已清除登录状态`);

      try {
        console.log(`${tag}正在登录...`);
        await loginPortal(page, acc);
        console.log(`${tag}登录成功，准备签到...`);

        const signinResult = await doSignin(page, SIGNIN_URL);
        console.log(`${tag}签到结果: ${signinResult.message}`);
      } catch (err) {
        console.error(`${tag}出错: ${err.message}`);
      }

      console.log(`${tag}--- 完成 ---\n`);
    }

    console.log('所有账号签到流程执行完毕');
  } catch (error) {
    console.error(`\n执行出错: ${error.message}`);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      console.log('浏览器已关闭');
    }
  }
}

main();
