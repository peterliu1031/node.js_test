const express = require('express');
const sqlite3 = require('sqlite3').verbose();//�}�p����
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const db = new sqlite3.Databse('data.db');
db.run(`CREATE TABLE IF NOT EXISTS sensor_data (
    temperature REAL,
    humidity REAL,
    timestamp TEXT
)`);

app.post('')