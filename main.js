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
  deviceData: undefined,
  wxbot: undefined,
  tunnel: undefined,
  logindone: function(data) {
    callback({eventType:'LOGINDONE', body: {
      userName: this.loginData.userName,
      wxData: this.deviceData.wxData,
      token: this.deviceData.token,
    }})
  },
  
  callback: function(data) {
    if (this.tunnel === undefined) {
      log.error('grpc connection not established while receiving wxlogin callback, exit.')
      return
    }
    
    log.info('wxbot callback ' +  stringify(data))
    if (data === undefined || data.eventType === undefined) {
      log.error('wxcallback data.eventType undefined')
      return
    }

    this.tunnel.write(newEventRequest(data.eventType, JSON.stringify(data.body)))
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
      log.info('begin login', body)
      let loginbody = JSON.parse(body)
      this.loginPass = loginbody.loginPass
      this.deviceData = loginbody.deviceData
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

async function runEventTunnel(bot) {
  log.info("begin grpc connection");
  botClient.flag = true;
  botClient.tunnel = client.eventTunnel();
  botClient.tunnel.on('data', function(eventReply) {
    var eventType = eventReply.getEventtype()
    var body = eventReply.getBody()
    var clientid = eventReply.getClientid()
    var clientType = eventReply.getClienttype()

    if (eventType == 'PONG') {
      //log.info("PONG " + clientType + " " + clientid);
    } else if (eventType == 'LOGIN') {
      log.info("LOGIN CMD");
      if (botClient.tunnel === undefined) {
	log.error('grpc botClient.tunnel undefined')
      }
      
      bot.handleLoginRequest(body);
    } else {
      log.info("unhandled message " + stringify(eventReply));
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
