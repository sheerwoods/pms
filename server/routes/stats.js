// 今日经营概况
const express = require('express');
const { q, get } = require('../db');
const { wrap } = require('../errors');
const { today, round2 } = require('../utils');
const { currentBusinessDate } = require('../accounting');

const router = express.Router();

router.get('/stats/today', wrap((req, res) => {
  const T = today();
  // 均以子单为口径：与父单状态解耦，部分入住订单也能正确统计
  const arrivals = get(
    `SELECT COUNT(*) AS c FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id
     WHERE rr.status='pending' AND r.status NOT IN ('cancelled','no_show','checked_out') AND r.check_in_date=?`,
    T
  ).c;
  const departures = get(
    `SELECT COUNT(*) AS c FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id
     WHERE rr.status='checked_in' AND r.status NOT IN ('cancelled','no_show')
       AND COALESCE(rr.actual_check_out, r.check_out_date)=?`,
    T
  ).c;
  // 在住房间数（按在住子单计）
  const inHouse = get(
    `SELECT COUNT(*) AS c FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id
     WHERE rr.status='checked_in' AND r.status NOT IN ('cancelled','no_show')`
  ).c;
  const totalRooms = get('SELECT COUNT(*) AS c FROM rooms').c || 1;
  const ooo = get("SELECT COUNT(*) AS c FROM rooms WHERE status='ooo'").c;
  const occupied = inHouse;
  const vacant = Math.max(0, totalRooms - ooo - occupied);
  // 营收按营业日归集，口径与营业报表 charge_total 一致（房费+杂费）
  const bd = currentBusinessDate();
  const revenue = get(
    "SELECT COALESCE(SUM(amount),0) AS s FROM folio_items WHERE item_type IN ('room_charge','extra_charge') AND COALESCE(business_date, date(created_at))=?",
    bd
  ).s;
  res.json({
    date: T,
    business_date: bd,
    arrivals,
    departures,
    in_house: inHouse,
    vacant,
    occupancy_rate: Math.round((inHouse / totalRooms) * 1000) / 10,
    revenue: round2(revenue),
  });
}));

module.exports = router;
