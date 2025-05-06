const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

/**�w�w 1. ��l�� SQLite ��Ʈw �w�w**/
const db = new sqlite3.Database('data.db');
db.run(`
  CREATE TABLE IF NOT EXISTS sensor_data (
    temperature REAL,
    humidity REAL,
    timestamp TEXT
  )
`);

/**�w�w 2. �ŷë׸�� �W�ǻP�d�� �w�w**/
// ���o�̪� limit ���ŷë׼ƾ�
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

// ���� ESP32 �o�Ӫ��ŷë׼ƾڨæs��
app.post('/data', (req, res) => {
  const { temp, hum } = req.query;
  if (!temp || !hum) {
    return res.status(400).json({ status: 'error', message: '�ʤ� temp �� hum �Ѽ�' });
  }
  const t = Math.round(parseFloat(temp));
  const h = Math.round(parseFloat(hum));
  if (isNaN(t) || isNaN(h)) {
    return res.status(400).json({ status: 'error', message: 'temp �� hum �����O�Ʀr' });
  }

  const timestamp = new Date().toISOString();
  db.run(
    'INSERT INTO sensor_data (temperature, humidity, timestamp) VALUES (?, ?, ?)',
    [t, h, timestamp],
    err => {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      console.log('����ŷë�:', { temperature: t, humidity: h, timestamp });
      res.json({ status: 'success', data: { temperature: t, humidity: h, timestamp } });
    }
  );
});

/**�w�w 3. ���Ȫ��A�޲z�G�� Map �s��C�x�������u�@��T �w�w**/
const tasks = new Map();

/**�w�w 4. ���ݱҰʡ��Ȱ�����_������ ���� �w�w**/
// �}�l�M��
app.post('/api/device/:deviceId/start', (req, res) => {
  const { deviceId } = req.params;
  const { mode, duration } = req.body;
  if (!mode || !duration || isNaN(duration) || duration <= 0) {
    return res.status(400).json({ success: false, message: 'mode �� duration �L��' });
  }
  tasks.set(deviceId, {
    mode,
    duration: parseInt(duration),
    startTime: Math.floor(Date.now() / 1000),
    elapsed: 0
  });
  res.json({ success: true, message: '�w�}�l�M��' });
});

// �Ȱ��M��
app.post('/api/device/:deviceId/pause', (req, res) => {
  const { deviceId } = req.params;
  const task = tasks.get(deviceId);
  if (!task) {
    return res.status(400).json({ success: false, message: '�䤣����椤����' });
  }
  const now = Math.floor(Date.now() / 1000);
  task.elapsed += now - task.startTime;
  tasks.set(deviceId, task);
  res.json({ success: true, message: '�w�Ȱ��M��' });
});

// ��_�M��
app.post('/api/device/:deviceId/resume', (req, res) => {
  const { deviceId } = req.params;
  const task = tasks.get(deviceId);
  if (!task) {
    return res.status(400).json({ success: false, message: '�䤣��Ȱ���������' });
  }
  task.startTime = Math.floor(Date.now() / 1000);
  tasks.set(deviceId, task);
  res.json({ success: true, message: '�w��_�M��' });
});

// ����M��
app.post('/api/device/:deviceId/stop', (req, res) => {
  const { deviceId } = req.params;
  if (!tasks.has(deviceId)) {
    return res.status(400).json({ success: false, message: '�䤣����椤����' });
  }
  tasks.delete(deviceId);
  res.json({ success: true, message: '�w����M��' });
});

/**�w�w 5. �d�ߪ��A�G��Ѿl�ɶ��æ^�ǳ̷s�ŷë� �w�w**/
app.get('/api/device/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  const task = tasks.get(deviceId);
  
  db.get('SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT 1', (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ running: false, message: '��Ʈw�d�ߥ���' });
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

/**�w�w 6. �Ұʦ��A�� & �M�z �w�w**/
app.listen(port, () => {
  console.log(`��x�B��� http://localhost:${port}`);
});

process.on('SIGINT', () => {
  console.log('������Ʈw�s�u...');
  db.close(err => {
    if (err) console.error('������Ʈw�ɥX��:', err.message);
    process.exit(0);
  });
});