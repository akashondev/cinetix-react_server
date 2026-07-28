function automaticVisibilityCutoff(now = new Date()) {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 2
    )
  );
}

function ticketVisibilityFilter(userId, now = new Date()) {
  return {
    user: userId,
    hiddenByUserAt: null,
    $or: [
      { date: { $gt: automaticVisibilityCutoff(now) } },
      { date: { $exists: false } },
    ],
  };
}

function parseShowTime(time) {
  const match = String(time || "")
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    minute > 59 ||
    (match[3] && (hour < 1 || hour > 12)) ||
    (!match[3] && hour > 23)
  ) {
    return null;
  }
  if (match[3] === "AM" && hour === 12) hour = 0;
  if (match[3] === "PM" && hour !== 12) hour += 12;
  return { hour, minute };
}

function showDateTime(ticket) {
  const date = new Date(ticket?.date);
  const time = parseShowTime(ticket?.time);
  if (Number.isNaN(date.getTime()) || !time) return null;

  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      time.hour,
      time.minute
    )
  );
}

function isShowExpired(ticket, now = new Date()) {
  const show = showDateTime(ticket);
  return show ? show.getTime() < now.getTime() : false;
}

module.exports = {
  automaticVisibilityCutoff,
  isShowExpired,
  ticketVisibilityFilter,
};
