var messages = require('./proto/chatbothub/chatbothub_pb');
var services = require('./proto/chatbothub/chatbothub_grpc_pb');

var async = require('async');
var fs = require('fs');
var parseArgs = require('minimist');
var path = require('path');
var _ = require('lodash');
var grpc = require('grpc');
var log4js = require('log4js');
var stringify = require('json-stringify');

var baseBot = require('./libs/baseBot.socket');
let router = require('./libs/wxSocketMsgRouter');
var config = require('./config/config.json');

var client = new services.ChatBotHubClient(`127.0.0.1:${config.hubport}`, grpc.credentials.createInsecure());

try {
  require('fs').mkdirSync('./logs')
} catch (e) {
  if (e.code !== 'EEXIST') {
    console.error('Could not set up log directory, error: ', e)
    process.exit(1)
  }
}

try {
  log4js.configure('config/log4js.json')
} catch (e) {
  console.error('载入log4js日志输出配置错误: ', e)
  process.exit(1);
}

const log = log4js.getLogger('rpc');

function newEventRequest(eventType, body) {
  req = new messages.EventRequest()
  req.setEventtype(eventType)
  req.setBody(body)
  req.setClientid(botClient.clientId)
  req.setClienttype(botClient.clientType)

  return req;
}

var botClient = {
  clientId: config.clientId,
  clientType: "WECHATBOT",
  flag: true,
  loginData: undefined,
  loginPass: undefined,
  loginInfo: undefined,
  botId: undefined,
  wxbot: undefined,
  tunnel: undefined,
  logindone: function(data) {
    this.callback({eventType:'LOGINDONE', body: {
      userName: this.loginData.userName,
      wxData: this.loginInfo.wxData,
      token: this.loginInfo.token,
      botId: this.botId,
    }})
  },

  actionreply: function(eventType, body, result) {
    this.callback({eventType: 'ACTIONREPLY',
		   body: {
		     eventType: eventType,
		     body: body,
		     result: result }
		  })
  },
  
  callback: function(data) {
    if (this.tunnel === undefined) {
      log.error('grpc connection not established while receiving wxlogin callback, exit.')
      return
    }

    if(data.eventType != "LOGINDONE" && data.eventType != "IMAGEMESSAGE") {
      log.info('wxbot callback ' +  stringify(data))
    } else {
      log.info('wxbot callback ' + data.eventType)
    }
    
    if (data === undefined || data.eventType === undefined) {
      log.error('wxcallback data.eventType undefined')
      return
    }

    this.tunnel.write(newEventRequest(data.eventType, stringify(data.body)))
  },
  
  handleLoginRequest: function(body) {
    log.info('handle login')
    if (this.tunnel === undefined) {
      log.error('grpc tunnel undefined')
    }
    
    if (this.wxbot) {
      log.error("cannot login again while current bot is running.")
      
      this.tunnel.write(
	newEventRequest("LOGINFAILED", "cannot login again while current bot is running."))
    } else {
      log.info('begin login')
      let loginbody = JSON.parse(body)
      this.loginPass = {login: loginbody.login, password: loginbody.password}      
      this.botId = loginbody.botId
      
      if (loginbody.loginInfo.length > 0) {
	let loginInfo = JSON.parse(loginbody.loginInfo)	
	this.loginInfo = loginInfo
      }
      this.wxbot = baseBot(config, this)
      this.wxbot.on('push', data => {
	router.handle(data, this.wxbot)
      })
    }
  }
}

//router.botClient = botClient;
router.text(/.*/, async (msg, wx) => {
  botClient.callback({eventType: 'MESSAGE', body: stringify(msg)})
})

router.link(/.*/, async (msg, wx) => {
  botClient.callback({eventType: 'MESSAGE', body: stringify(msg)})
})

async function runEventTunnel(bot) {
  log.info("begin grpc connection");
  botClient.flag = true;
  botClient.tunnel = client.eventTunnel();
  botClient.tunnel.on('data', async function(eventReply) {
    var eventType = eventReply.getEventtype()
    var body = eventReply.getBody()
    var clientid = eventReply.getClientid()
    var clientType = eventReply.getClienttype()

    if (eventType == 'PONG') {
      //log.info("PONG " + clientType + " " + clientid);
    } else {
      if (botClient.tunnel === undefined) {
	log.error('grpc botClient.tunnel undefined')
	return
      }

      log.info("CMD ", eventType);
      
      if (eventType == 'LOGIN') {	
	bot.handleLoginRequest(body);
      } else if (eventType == 'LOGOUT') {
	let ret = await bot.wxbot.logout()
      } else if (eventType == 'BOTACTION') {
	if (bot.wxbot === undefined) {
	  bot.actionreply(eventType, body, {success: false, msg: "bot instance is gone away"})
	  return	  
	}

	let actionBody = JSON.parse(body)
	let actionType = actionBody.actionType

	if (actionType === undefined || actionBody.body === undefined) {
	  log.error("actionBody empty", body)
	  return
	}
	
	var ret
	var bodym = JSON.parse(actionBody.body)
	log.info("actionBody %o", actionBody)
	
	if (actionType == "SendTextMessage") {
	  toUserName = bodym.toUserName
	  content = bodym.content
	  atList = bodym.atList
	  if (toUserName === undefined || content === undefined || atList === undefined) {
	    log.error("send text message empty")
	    return
	  }
	
	  ret = await bot.wxbot.sendMsg(toUserName, content, atList)

	} else if (actionType == "SendAppMessage") {
	  toUserName = bodym.toUserName
	  object = bodym.object
	  if (toUserName === undefined || object === undefined) {
	    log.error("send app message empty")
	    return
	  }
	  ret = await bot.wxbot.sendAppMsg(toUserName, object)
	} else if (actionType == "SendImageMessage") {
	  toUserName = bodym.toUserName
	  rawFile = bodym.rawFile
	  if (toUserName === undefined || rawFile === undefined) {
	    log.error("send image message empty")
	    return
	  }
	  ret = await bot.wxbot.sendImage(toUsreName, rawFile)
	} else if (actionType == "AcceptUser") {
	  stranger = bodym.stranger
	  ticket = bodym.ticket
	  if (stranger === undefined || ticket === undefined ) {
	    log.error("accept user message empty")
	    return
	  }
	  ret = await bot.wxbot.acceptUser(stranger, ticket)
	} else if (actionType == "AddContact") {
	  stranger = bodym.stranger
	  ticket = bodym.ticket
	  type = bodym.type
	  content = bodym.content
	  if (stranger === undefined || ticket === undefined || type === undefined) {
	    log.error("add contact message empty")
	    return
	  }
	  
	  if (content === undefined) {
	    ret = await bot.wxbot.addContact(stranger, ticket, type)
	  } else {
	    ret = await bot.wxbot.addContact(stranger, ticket, type, content)
	  }
	} else if (actionType == "SayHello") {
	  stranger = bodym.stranger
	  ticket = bodym.ticket
	  content = bodym.content
	  if (stranger === undefined || ticket === undefined || content === undefined) {
	    log.error("say hello message empty")
	    return
	  }
	  ret = await bot.wxbot.SayHello(stranger, ticket, content)
	} else if (actionType == "GetContact") {
	  userId = bodym.userId
	  if (userId === undefined) {
	    log.error("get contact message empty")
	    return
	  }
	  ret = await bot.wxbot.getContact(userId)
	} else if (actionType == "CreateRoom") {
	  userList = bodym.userList
	  log.info("create room userlist %o", userList)
	  if (userList === undefined) {
	    log.error("create room message empty")
	    return
	  }
	  ret = await bot.wxbot.createRoom(userList)
	} else if (actionType == "GetRoomMembers") {
	  groupId = bodym.groupId
	  if (groupId === undefined) {
	    log.error("get room members message empty")
	    return
	  }
	  ret = await bot.wxbot.getRoomMembers(groupId)
	} else if (actionType == "GetRoomQRCode") {
	  groupId = bodym.groupId
	  if (groupId === undefined) {
	    log.error("get room QRCode message empty")
	    return
	  }
	  ret = await bot.wxbot.getRoomQrcode(groupId)
	} else if (actionType == "AddRoomMember") {
	  groupId = bodym.groupId
	  userId = bodym.userId
	  if (groupId === undefined || userId === undefined ) {
	    log.error("add room member message empty")
	    return
	  }
	  ret = await bot.wxbot.addRoomMember(groupId, userId)
	} else if (actionType == "InviteRoomMember") {
	  groupId = bodym.groupId
	  userId = bodym.userId
	  if (groupId === undefined || userId === undefined ) {
	    log.error("invite room member message empty")
	    return
	  }
	  ret = await bot.wxbot.inviteRoomMember(groupId, userId)
	} else if (actionType == "DeleteRoomMember") {
	  groupId = bodym.groupId
	  userId = bodym.userId
	  if (groupId === undefined || userId === undefined ) {
	    log.error("delete room member message empty")
	    return
	  }
	  ret = await bot.wxbot.deleteRoomMember(groupId, userId)
	} else if (actionType == "SetRoomAnnouncement") {
	  groupId = bodym.groupId
	  content = bodym.content
	  if (groupId === undefined || userId === undefined ) {
	    log.error("set room announcement message empty")
	    return
	  }
	  ret = await bot.wxbot.setRoomAnnouncement(groupId, content)
	} else if (actionType == "SetRoomName") {
	  groupId = bodym.groupId
	  content = bodym.content
	  if (groupId === undefined || userId === undefined ) {
	    log.error("set room name message empty")
	    return
	  }
	  ret = await bot.wxbot.setRoomName(groupId, content)	
	} else if (actionType == "GetContantQRCode") {
	  userId = bodym.userId
	  style = bodym.style
	  if (userId === undefined || style === undefined) {
	    log.error("get contact qrcode message empty")
	    return
	  }
	  ret = await bot.wxbot.getContactQrcode(userId, style)
	} else {
	  log.error("unsupported action", actionType)
	}

	if (ret !== undefined) {
	  bot.actionreply(eventType, actionBody, ret)
	}
      } else {
	log.info("unhandled message " + stringify(eventReply));
      }
    }
  });

  botClient.tunnel.on('error', function(e) {
    log.error("grpc connection error", "code", e.code, e.details);
    botClient.flag = false;
    botClient.tunnel.end();
  });

  botClient.tunnel.on('end', function() {
    log.info("grpc connection closed");
  });

  await botClient.tunnel.write(newEventRequest("REGISTER", "HELLO"));

  if(botClient.loginData != undefined) {
    log.info("resend login data...");
    await botClient.logindone();
  }

  while (botClient.flag) {
    await botClient.tunnel.write(newEventRequest("PING", ""));
    await sleep(10 * 1000);
  }

  botClient.tunnel.end();
}

function sleep(ms) {
  return new Promise(resolve=>{
    setTimeout(resolve, ms)
  })
}

async function main() {
  while(true) {
    try {
      await runEventTunnel(botClient);
    } catch (e) {
      log.error("connection failed, retrying ... ", e)
    }
    await sleep(10 * 1000);
  }
}

if (require.main === module) {
  main();
}

exports.runEventTunnel = runEventTunnel;
