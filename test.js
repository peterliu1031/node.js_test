const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

/**── 1. 初始化 SQLite 資料庫 ──**/
const db = new sqlite3.Database('data.db');
db.run(`
  CREATE TABLE IF NOT EXISTS sensor_data (
    temperature REAL,
    humidity REAL,
    timestamp TEXT
  )
`);

/**── 2. 溫溼度資料 上傳與查詢 ──**/
// 取得最近 limit 筆溫溼度數據
app.get('/data', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  db.all(
    `SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT ?`,
    [limit],
    (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      res.json(rows);
    }
  );
});

// 接收 ESP32 發來的溫溼度數據並存檔
app.post('/data', (req, res) => {
  const { temp, hum } = req.query;
  if (!temp || !hum) {
    return res.status(400).json({ status: 'error', message: '缺少 temp 或 hum 參數' });
  }
  const t = Math.round(parseFloat(temp));
  const h = Math.round(parseFloat(hum));
  if (isNaN(t) || isNaN(h)) {
    return res.status(400).json({ status: 'error', message: 'temp 或 hum 必須是數字' });
  }

  const timestamp = new Date().toISOString();
  db.run(
    'INSERT INTO sensor_data (temperature, humidity, timestamp) VALUES (?, ?, ?)',
    [t, h, timestamp],
    err => {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      console.log('收到溫溼度:', { temperature: t, humidity: h, timestamp });
      res.json({ status: 'success', data: { temperature: t, humidity: h, timestamp } });
    }
  );
});

/**── 3. 任務狀態管理：用 Map 存放每台機器的工作資訊 ──**/
const tasks = new Map();

/**── 4. 遠端啟動／暫停／恢復／停止 路由 ──**/
// 開始烘乾
app.post('/api/device/:deviceId/start', (req, res) => {
  const { deviceId } = req.params;
  const { mode, duration } = req.body;
  if (!mode || !duration || isNaN(duration) || duration <= 0) {
    return res.status(400).json({ success: false, message: 'mode 或 duration 無效' });
  }
  tasks.set(deviceId, {
    mode,
    duration: parseInt(duration),
    startTime: Math.floor(Date.now() / 1000),
    elapsed: 0
  });
  res.json({ success: true, message: '已開始烘乾' });
});

// 暫停烘乾
app.post('/api/device/:deviceId/pause', (req, res) => {
  const { deviceId } = req.params;
  const task = tasks.get(deviceId);
  if (!task) {
    return res.status(400).json({ success: false, message: '找不到執行中任務' });
  }
  const now = Math.floor(Date.now() / 1000);
  task.elapsed += now - task.startTime;
  tasks.set(deviceId, task);
  res.json({ success: true, message: '已暫停烘乾' });
});

// 恢復烘乾
app.post('/api/device/:deviceId/resume', (req, res) => {
  const { deviceId } = req.params;
  const task = tasks.get(deviceId);
  if (!task) {
    return res.status(400).json({ success: false, message: '找不到暫停中的任務' });
  }
  task.startTime = Math.floor(Date.now() / 1000);
  tasks.set(deviceId, task);
  res.json({ success: true, message: '已恢復烘乾' });
});

// 停止烘乾
app.post('/api/device/:deviceId/stop', (req, res) => {
  const { deviceId } = req.params;
  if (!tasks.has(deviceId)) {
    return res.status(400).json({ success: false, message: '找不到執行中任務' });
  }
  tasks.delete(deviceId);
  res.json({ success: true, message: '已停止烘乾' });
});

/**── 5. 查詢狀態：算剩餘時間並回傳最新溫溼度 ──**/
app.get('/api/device/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  const task = tasks.get(deviceId);
  
  db.get('SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT 1', (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ running: false, message: '資料庫查詢失敗' });
    }
    
    if (!task) {
      return res.json({
        running: false,
        temperature: row ? row.temperature : null,
        humidity: row ? row.humidity : null
      });
    }
    
    const now = Math.floor(Date.now() / 1000);
    const totalElapsed = task.elapsed + (now - task.startTime);
    const remainingSeconds = Math.max(0, task.duration - totalElapsed);

    res.json({
      running: remainingSeconds > 0,
      mode: task.mode,
      remainingSeconds,
      temperature: row ? row.temperature : null,
      humidity: row ? row.humidity : null
    });
  });
});

/**── 6. 啟動伺服器 & 清理 ──**/
app.listen(port, () => {
  console.log(`後台運行於 http://localhost:${port}`);
});

process.on('SIGINT', () => {
  console.log('關閉資料庫連線...');
  db.close(err => {
    if (err) console.error('關閉資料庫時出錯:', err.message);
    process.exit(0);
  });
});