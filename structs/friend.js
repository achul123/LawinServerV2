const Friends = require("../model/friends.js");
const functions = require("../structs/functions.js");

async function validateFriendAdd(accountId, friendId) {
  let sender = await Friends.findOne({ accountId: accountId }).lean();
  let receiver = await Friends.findOne({ accountId: friendId }).lean();
  if (!sender || !receiver) return false;

  if (
    sender.list.accepted.find((i) => i.accountId == receiver.accountId) ||
    receiver.list.accepted.find((i) => i.accountId == sender.accountId)
  )
    return false;
  if (
    sender.list.blocked.find((i) => i.accountId == receiver.accountId) ||
    receiver.list.blocked.find((i) => i.accountId == sender.accountId)
  )
    return false;
  if (sender.accountId == receiver.accountId) return false;

  return true;
}

async function validateFriendDelete(accountId, friendId) {
  let sender = await Friends.findOne({ accountId: accountId }).lean();
  let receiver = await Friends.findOne({ accountId: friendId }).lean();
  if (!sender || !receiver) return false;

  return true;
}

async function validateFriendBlock(accountId, friendId) {
  let sender = await Friends.findOne({ accountId: accountId }).lean();
  let receiver = await Friends.findOne({ accountId: friendId }).lean();
  if (!sender || !receiver) return false;

  if (sender.list.blocked.find((i) => i.accountId == receiver.accountId))
    return false;
  if (sender.accountId == receiver.accountId) return false;

  return true;
}

async function sendFriendReq(fromId, toId) {
  if (!(await validateFriendAdd(fromId, toId))) return false;

  let from = await Friends.findOne({ accountId: fromId });
  let fromFriends = from.list;

  let to = await Friends.findOne({ accountId: toId });
  let toFriends = to.list;

  fromFriends.outgoing.push({
    accountId: to.accountId,
    created: new Date().toISOString(),
  });

  functions.sendXmppMessageToId(
    {
      payload: {
        accountId: to.accountId,
        status: "PENDING",
        direction: "OUTBOUND",
        created: new Date().toISOString(),
        favorite: false,
      },
      type: "com.epicgames.friends.core.apiobjects.Friend",
      timestamp: new Date().toISOString(),
    },
    from.accountId
  );

  toFriends.incoming.push({
    accountId: from.accountId,
    created: new Date().toISOString(),
  });

  functions.sendXmppMessageToId(
    {
      payload: {
        accountId: from.accountId,
        status: "PENDING",
        direction: "INBOUND",
        created: new Date().toISOString(),
        favorite: false,
      },
      type: "com.epicgames.friends.core.apiobjects.Friend",
      timestamp: new Date().toISOString(),
    },
    to.accountId
  );

  await from.updateOne({ $set: { list: fromFriends } });
  await to.updateOne({ $set: { list: toFriends } });

  return true;
}

async function acceptFriendReq(fromId, toId) {
  if (!(await validateFriendAdd(fromId, toId))) return false;

  let from = await Friends.findOne({ accountId: fromId });
  let fromFriends = from.list;

  let to = await Friends.findOne({ accountId: toId });
  let toFriends = to.list;

  let incomingIndex = fromFriends.incoming.findIndex(
    (i) => i.accountId == to.accountId
  );

  if (incomingIndex != -1) {
    fromFriends.incoming.splice(incomingIndex, 1);
    fromFriends.accepted.push({
      accountId: to.accountId,
      created: new Date().toISOString(),
    });

    functions.sendXmppMessageToId(
      {
        payload: {
          accountId: to.accountId,
          status: "ACCEPTED",
          direction: "OUTBOUND",
          created: new Date().toISOString(),
          favorite: false,
        },
        type: "com.epicgames.friends.core.apiobjects.Friend",
        timestamp: new Date().toISOString(),
      },
      from.accountId
    );

    toFriends.outgoing.splice(
      toFriends.outgoing.findIndex((i) => i.accountId == from.accountId),
      1
    );
    toFriends.accepted.push({
      accountId: from.accountId,
      created: new Date().toISOString(),
    });

    functions.sendXmppMessageToId(
      {
        payload: {
          accountId: from.accountId,
          status: "ACCEPTED",
          direction: "OUTBOUND",
          created: new Date().toISOString(),
          favorite: false,
        },
        type: "com.epicgames.friends.core.apiobjects.Friend",
        timestamp: new Date().toISOString(),
      },
      to.accountId
    );

    await from.updateOne({ $set: { list: fromFriends } });
    await to.updateOne({ $set: { list: toFriends } });
  }

  return true;
}

async function deleteFriend(fromId, toId) {
  if (!(await validateFriendDelete(fromId, toId))) return false;

  let from = await Friends.findOne({ accountId: fromId });
  let fromFriends = from.list;

  let to = await Friends.findOne({ accountId: toId });
  let toFriends = to.list;

  let removed = false;

  for (let listType in fromFriends) {
    let findFriend = fromFriends[listType].findIndex(
      (i) => i.accountId == to.accountId
    );
    let findToFriend = toFriends[listType].findIndex(
      (i) => i.accountId == from.accountId
    );

    if (findFriend != -1) {
      fromFriends[listType].splice(findFriend, 1);
      removed = true;
    }

    if (listType == "blocked") continue;

    if (findToFriend != -1) toFriends[listType].splice(findToFriend, 1);
  }

  if (removed == true) {
    functions.sendXmppMessageToId(
      {
        payload: {
          accountId: to.accountId,
          reason: "DELETED",
        },
        type: "com.epicgames.friends.core.apiobjects.FriendRemoval",
        timestamp: new Date().toISOString(),
      },
      from.accountId
    );

    functions.sendXmppMessageToId(
      {
        payload: {
          accountId: from.accountId,
          reason: "DELETED",
        },
        type: "com.epicgames.friends.core.apiobjects.FriendRemoval",
        timestamp: new Date().toISOString(),
      },
      to.accountId
    );

    await from.updateOne({ $set: { list: fromFriends } });
    await to.updateOne({ $set: { list: toFriends } });
  }

  return true;
}

async function blockFriend(fromId, toId) {
  if (!(await validateFriendDelete(fromId, toId))) return false;
  if (!(await validateFriendBlock(fromId, toId))) return false;
  await deleteFriend(fromId, toId);

  let from = await Friends.findOne({ accountId: fromId });
  let fromFriends = from.list;

  let to = await Friends.findOne({ accountId: toId });

  fromFriends.blocked.push({
    accountId: to.accountId,
    created: new Date().toISOString(),
  });

  await from.updateOne({ $set: { list: fromFriends } });

  return true;
}

module.exports = {
  validateFriendAdd,
  validateFriendDelete,
  sendFriendReq,
  acceptFriendReq,
  blockFriend,
  deleteFriend,
};
