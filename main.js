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
  req = new messages.EventRequest();
  req.setEventtype(eventType);
  req.setBody(body);
  req.setClientid(botClient.clientId);
  req.setClienttype(botClient.clientType);

  return req;
}

var botClient = {
  clientId: config.clientId,
  clientType: "WECHATBOT",
  wxbot: undefined,
  handleLogin: function(call) {
    if (this.wxbot) {
      log.error("cannot login again while current bot is running.");
      
      call.write(
	newEventRequest("LOGINFAILED", "cannot login again while current bot is running."));
    } else {
      this.wxbot = baseBot(config);
    }
  }
}

async function runEventTunnel(bot) {
  try {
    var call = client.eventTunnel();
    call.on('data', function(eventReply) {
      var eventType = eventReply.getEventtype()
      var body = eventReply.getBody()
      var clientid = eventReply.getClientid()
      var clientType = eventReply.getClienttype()

      if (eventType == 'PONG') {
	log.info("PONG " + clientType + " " + clientid);
      } else if (eventType == 'LOGIN') {
	bot.handleLogin(call);
      } else {
	log.info("unhandled message " + stringify(eventReply));
      }
    });

    call.on('end', function() {
      console.log("connection closed");
    });

    await call.write(newEventRequest("REGISTER", "HELLO"));

    while (true) {
      await call.write(newEventRequest("PING", ""));
      await sleep(10 * 1000);
    }

    call.end();
  } catch (e) {
    console.log(e);
  }
}

function sleep(ms) {
  return new Promise(resolve=>{
    setTimeout(resolve, ms)
  })
}

function main() {
  runEventTunnel(botClient);
}

if (require.main === module) {
  main();
}

exports.runEventTunnel = runEventTunnel;
