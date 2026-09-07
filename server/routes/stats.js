// 今日经营概况
const express = require('express');
const { q, get } = require('../db');
const { wrap } = require('../errors');
const { today, round2 } = require('../utils');

const router = express.Router();

router.get('/stats/today', wrap((req, res) => {
  const T = today();
  const arrivals = get("SELECT COUNT(*) AS c FROM reservations WHERE status='reserved' AND check_in_date=?", T).c;
  const departures = get("SELECT COUNT(*) AS c FROM reservations WHERE status='checked_in' AND check_out_date=?", T).c;
  const inHouse = get("SELECT COUNT(*) AS c FROM reservations WHERE status='checked_in'").c;
  const totalRooms = get('SELECT COUNT(*) AS c FROM rooms').c || 1;
  const ooo = get("SELECT COUNT(*) AS c FROM rooms WHERE status='ooo'").c;
  const occupied = get("SELECT COUNT(*) AS c FROM reservations WHERE status='checked_in' AND room_id IS NOT NULL").c;
  const vacant = Math.max(0, totalRooms - ooo - occupied);
  const revenue = get(
    "SELECT COALESCE(SUM(amount),0) AS s FROM folio_items WHERE item_type IN ('room_charge','extra_charge','adj') AND date(created_at)=?",
    T
  ).s;
  res.json({
    date: T,
    arrivals,
    departures,
    in_house: inHouse,
    vacant,
    occupancy_rate: Math.round((inHouse / totalRooms) * 1000) / 10,
    revenue: round2(revenue),
  });
}));

module.exports = router;
