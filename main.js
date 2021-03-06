var messages = require('./proto/chatbothub/chatbothub_pb')
var services = require('./proto/chatbothub/chatbothub_grpc_pb')

var async = require('async')
var fs = require('fs')
var parseArgs = require('minimist')
var path = require('path')
var _ = require('lodash')
var grpc = require('grpc')
var log4js = require('log4js')
var stringify = require('json-stringify')
const uuidv4  = require('uuid/v4')
const image2base64 = require('image-to-base64')
const OSS     = require('ali-oss')

var baseBot = require('./libs/baseBot.socket')
let router = require('./libs/wxSocketMsgRouter')
var config = require('./config/config.json')

var client = new services.ChatBotHubClient(`127.0.0.1:${config.hubport}`, grpc.credentials.createInsecure())

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
  process.exit(1)
}

const log = log4js.getLogger('rpc')
var ossClient = null

if (!config.oss) {
  log.error("cannot read config.oss, ignore")
} else {
  ossClient = new OSS({
    region: config.oss.region,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    bucket: config.oss.bucket,
  })
}

function newEventRequest(eventType, body) {
  req = new messages.EventRequest()
  req.setEventtype(eventType)
  req.setBody(body)
  req.setClientid(botClient.clientId)
  req.setClienttype(botClient.clientType)

  return req
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
  qrcode: undefined,

  logindone: function(data) {
    // remove qrcode on login done
    this.qrcode = undefined
    
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

    if(data.eventType != "LOGINDONE" && data.eventType != "IMAGEMESSAGE" && data.eventType != "ACTIONREPLY") {
      log.info('wxbot callback ' +  stringify(data).substr(0, 240))
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
      this.wxbot
        .on('push', async (data) => {
	  router.handle(data, this.wxbot)
        })
        .on('contact', async (data) => {
          router.handle(data, this.wxbot)
        })
    }
  }
}

//router.botClient = botClient
router.text(/.*/, async (msg, wx) => {
  botClient.callback({eventType: 'MESSAGE', body: stringify(msg)})
})

router.link(/.*/, async (msg, wx) => {
  botClient.callback({eventType: 'MESSAGE', body: stringify(msg)})
})

router.contactPush(async (msg, wx) => {
  botClient.callback({eventType: 'CONTACTINFO', body: msg})
})

router.groupPush(async (msg, wx) => {
  botClient.callback({eventType:'GROUPINFO', body:msg})
})

router.emoji(async (msg, wx) => {
  if(!msg.content || !msg.content.msg || !msg.content.msg.emoji || !msg.content.msg.emoji.$) {
    log.error("emoji msg dont have msg.content.msg.emoji.$\n%o\n", msg)
    return
  }

  let imageurl = msg.content.msg.emoji.$.cdnurl
  console.log("downloading %s", imageurl)
  let emojiId = botClient.loginData.userName + "-" + uuidv4()
  let imageb64 = await image2base64(imageurl)
  console.log("downloaded %d %s...", imageb64.length, imageb64.substr(0, 20))
  fs.writeFileSync(`cache/${emojiId}`, imageb64)
  msg.emojiId = emojiId

  if(ossClient) {
    log.info(`上传emoji至aliyun oss... chathub/emoji/${emojiId}`)
    ossClient.put(`chathub/emoji/${emojiId}`, Buffer.from(imageb64, 'base64')).then(result=>{
      if(result.res && result.res.status == 200) {
        log.info(`上传emoji ${result.name} 完成`)
      } else {
        log.info('上传emoji返回', result)
      }
    }).catch(err=>{
      log.error('上传emoji失败', err)
    })
  }
  
  botClient.callback({eventType: 'EMOJIMESSAGE', body: msg})
})

router.statusMessage(async (msg, wx) => {
  botClient.callback({eventType: 'STATUSMESSAGE', body: stringify(msg)})
})

async function runEventTunnel(bot) {
  log.info("begin grpc connection")
  botClient.flag = true
  botClient.tunnel = client.eventTunnel()
  botClient.tunnel.on('data', async function(eventReply) {
    var eventType = eventReply.getEventtype()
    var body = eventReply.getBody()
    var clientid = eventReply.getClientid()
    var clientType = eventReply.getClienttype()

    if (eventType == 'PONG') {
      //log.info("PONG " + clientType + " " + clientid)
    } else {
      if (botClient.tunnel === undefined) {
	log.error('grpc botClient.tunnel undefined')
	return
      }

      log.info("CMD ", eventType);
      
      if (eventType == 'LOGIN') {	
	bot.handleLoginRequest(body)
      } else if (eventType == 'BOTMIGRATE') {
        let bodym = JSON.parse(body)
        if (bodym.botId) {
          log.info("BOT MIGRATE (%s) -> (%s)", botClient.botId, bodym.botId)
          botClient.botId = bodym.botId
        }
        
      } else if (eventType == 'LOGOUT') {
	let ret = await bot.wxbot.logout()
      } else if (eventType == 'SHUTDOWN') {
        log.info("recieve cmd SHUTDOWN")
        process.exit(0)
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

	if(actionType != "SendImageMessage") {
	  log.info("actionBody %o", actionBody)
	} else {
	  log.info("actionType %s", actionType)
	}
	
	if (actionType == "SendTextMessage") {
	  let toUserName = bodym.toUserName
	  let content = bodym.content
	  let atList = bodym.atList
	  if (toUserName === undefined || content === undefined || atList === undefined) {
	    log.error("send text message empty")
	    return
	  }
	
	  ret = await bot.wxbot.sendMsg(toUserName, content, atList)
    if (ret.success) {
      let res = await bot.wxbot.getMyInfo();
      const myInfo = res.data
      res = await bot.wxbot.getContact(myInfo.userName)
      if (res.success) {
        const myContact = res.data
        ret.data = Object.assign(ret.data, {
          content: content,
          description: `${myContact.nickName} : ${content}`
        })
      }
    }
	} else if (actionType == "SendAppMessage") {
	  let toUserName = bodym.toUserName
	  if (bodym.object) {
	    let object = bodym.object
	    if (toUserName === undefined || object === undefined) {
	      log.error("send app message empty")
	      return
	    }
	    ret = await bot.wxbot.sendAppMsg(toUserName, object)
	  } else if (bodym.xml) {
	    let xml = bodym.xml
	    log.info("xml\n%s\n", xml)
	    ret = await bot.wxbot.sendAppMsg(toUserName, xml)
	    log.info("%o", ret)
	  }
        } else if (actionType == "SendImageMessage") {
          let toUserName = bodym.toUserName
          let payload = bodym.payload
          if (toUserName === undefined || payload === undefined ) {
            log.error("send image message empty")
            return
          }

          ret = await bot.wxbot.sendImage(toUserName, payload)
          log.info("send image %d returned %o", payload.length, ret)
          log.info(payload.substr(0, 80))

          // sdk 说，发送图片超时不一定代表发送失败, 所以不判断 ret.success

          let imageId = botClient.loginData.userName + "-" + uuidv4()

          if(ossClient) {
            try {
              log.info(`上传 发送图片 至aliyun oss... chathub/images/${imageId}`)

              const result = await ossClient.put(`chathub/images/${imageId}`, Buffer.from(payload, "base64"))
              if(result.res && result.res.status === 200) {
                log.info(`上传图片 ${result.name} 完成`)
              } else {
                imageId = null
                log.info('上传图片返回', result)
              }
            } catch (e) {
              log.error('上传 发送图片 失败', e)
              imageId = null
            }
          }

          let res = await bot.wxbot.getMyInfo();
          const myInfo = res.data
          res = await bot.wxbot.getContact(myInfo.userName);
          if (res.success) {
            const myContact = res.data
            ret.data = Object.assign(ret.data, {
              description: `${myContact.nickName} : [图片]`,
              imageId
            })
          }
	} else if (actionType == "SendImageResourceMessage") {
	  let toUserName = bodym.toUserName
	  let imageId = bodym.imageId
	  if (toUserName === undefined || imageId === undefined) {
	    log.error("send image message empty")
	    return
	  }

	  let rawFile = String(fs.readFileSync(`cache/${imageId}`))
	  ret = await bot.wxbot.sendImage(toUserName, rawFile)
	  log.info("send file %d returned %o", rawFile.length, ret)
	  log.info(rawFile.substr(0, 80))
	} else if (actionType == "AcceptUser") {
	  let stranger = bodym.stranger
	  let ticket = bodym.ticket
	  if (stranger === undefined || ticket === undefined ) {
	    log.error("accept user message empty")
	    return
	  }
	  ret = await bot.wxbot.acceptUser(stranger, ticket)
	} else if (actionType == "AddContact") {
	  let stranger = bodym.stranger
	  let ticket = bodym.ticket
	  let type = bodym.type
	  let content = bodym.content
	  if (stranger === undefined || ticket === undefined || type === undefined) {
	    log.error("add contact message empty")
	    return
	  }
	  
	  if (content === undefined) {
	    ret = await bot.wxbot.addContact(stranger, ticket, type)
	  } else {
	    ret = await bot.wxbot.addContact(stranger, ticket, type, content)
	  }
        } else if (actionType == "DeleteContact") {
          let userId = bodym.userId
          if (userId === undefined) {
            log.error("delete contact message empty")
            return
          }

          ret = await bot.wxbot.deleteContact(userId)
	} else if (actionType == "SayHello") {
	  stranger = bodym.stranger
	  ticket = bodym.ticket
	  content = bodym.content
	  if (stranger === undefined || ticket === undefined || content === undefined) {
	    log.error("say hello message empty")
	    return
	  }
	  ret = await bot.wxbot.SayHello(stranger, ticket, content)
        } else if (actionType == "SyncContact") {
          ret = await bot.wxbot.syncContact(true)
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

          if(ret.success && ret.data && ret.data.qrCode) {
            let roomNumber = groupId.substring(0, groupId.indexOf('@chatroom'))
            log.info('saving image for %s', roomNumber)
            
            let qrcode = ret.data.qrCode
            qrcode = qrcode.replace(/^data:image\/jpeg;base64,/, "")
            fs.writeFile(`./cache/${roomNumber}.jpg`, qrcode, 'base64', function(err) {
              log.error(err)
            })
          } else {
            log.error("get room qrcode failed with \n%o\n", ret)
          }
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
	  if (groupId === undefined || content === undefined ) {
	    log.error("set room announcement message empty")
	    return
	  }
	  ret = await bot.wxbot.setRoomAnnouncement(groupId, content)
	} else if (actionType == "SetRoomName") {
	  groupId = bodym.groupId
	  content = bodym.content
	  if (groupId === undefined || content === undefined ) {
	    log.error("set room name message empty")
	    return
	  }
	  ret = await bot.wxbot.setRoomName(groupId, content)
	} else if (actionType == "GetContactQRCode") {
	  userId = bodym.userId
	  style = bodym.style
	  if (userId === undefined || style === undefined) {
	    log.error("get contact qrcode message empty")
	    return
	  }
	  ret = await bot.wxbot.getContactQrcode(userId, style)          
	} else if (actionType == "SearchContact"){
	  userId = bodym.userId
	  if (userId === undefined) {
	    log.error("search contact message empty")
	    return
	  }
	  ret = await bot.wxbot.searchContact(userId)
        } else if (actionType == "SnsTimeline") {
          momentId = bodym.momentId
          if(momentId) {
            ret = await bot.wxbot.snsTimeline(momentId)
          } else {
            ret = await bot.wxbot.snsTimeline()
          }
        } else if (actionType == "SnsUserPage") {
          userId = bodym.userId
          momentId = bodym.momentId
          if(!userId) {
            log.error("snsUserPage userId null")
            return
          }
          if(momentId) {
            ret = await bot.wxbot.snsUserPage(userId, momentId)
          } else {
            ret = await bot.wxbot.snsUserPage(userId)
          }
        } else if (actionType == "SnsGetObject") {
          momentId = bodym.momentId
          if(!momentId) {
            log.error("snsGetObject momentId empty")
            return
          }

          ret = await bot.wxbot.snsGetObject(momentId)
        } else if(actionType == "SnsComment"){
          userId = bodym.userId
          momentId = bodym.momentId
          content = bodym.content
          if(!userId || !momentId || !content) {
            log.error("snsComment message empty")
            return
          }

          ret = await bot.wxbot.snsComment(userId, momentId, content)
        } else if(actionType == "SnsLike") {
          userId = bodym.userId
          momentId = bodym.momentId
          if(!userId || !momentId) {
            log.error("snsComment message empty")
            return
          }

          ret = await bot.wxbot.snsLike(userId, momentId)
        } else if(actionType == "SnsUpload") {
          file = bodym.file
          if(!file) {
            log.error("snsUpload message empty")
            return
          }
          ret = await bot.wxbot.snsUpload(file)
        } else if (actionType == "SnsobjectOP") {
          momentId = bodym.momentId
          type = bodym.type
          commentId = bodym.commentId
          commentType == bodym.commentType
          if(!momentId || !type || !commentId || !commentType) {
            log.error("snsobjectOP message empty")
            return
          }
          ret = await bot.wxbot.snsobjectOP(momentId, type, commentId, commentType)
        } else if (actionType == "SnsSendMoment") {
          content = bodym.content
          if(!content) {
            log.error("snsSendMoment message empty")
            return
          }
          ret = await bot.wxbot.snsSendMoment(content)
        } else if (actionType == "GetLabelList") {
          ret = await bot.wxbot.getLabelList()
        } else if (actionType == "AddLabel") {
          label = bodym.label
          if(!label) {
            log.error("addLabel message empty")
            return
          }
          ret = await bot.wxbot.addLabel(label)
        } else if (actionType == "DeleteLabel") {
          labelId = bodym.labelId
          if(!labelId) {
            log.error("deleteLabel message empty")
            return
          }
          ret = await bot.wxbot.deleteLabel(labelId)
        } else if (actionType == "SetLabel") {
          userId = bodym.userId
          labelId = bodym.labelId
          if(!userId || !labelId) {
            log.error("setLabel message empty")
            return
          }
          ret = await bot.wxbot.setLabel(userId, labelId)
	} else {
	  log.error("unsupported action", actionType)
	}

	if (ret !== undefined) {
	  bot.actionreply(eventType, actionBody, ret)

          if (eventType == 'LOGOUT') {
            log.info('LOGOUT DONE %o, shut down...', ret)
            process.exit(0)
          }          
	}
      } else {
	log.info("unhandled message " + stringify(eventReply))
      }
    }
  });

  botClient.tunnel.on('error', function(e) {
    log.error("grpc connection error", "code", e.code, e.details)
    botClient.flag = false
    botClient.tunnel.end()
  })

  botClient.tunnel.on('end', function() {
    log.info("grpc connection closed")
  })

  await botClient.tunnel.write(newEventRequest("REGISTER", "HELLO"))

  if(botClient.loginData != undefined) {
    log.info("resend login data...")
    await botClient.logindone()
  } else if (botClient.qrcode != undefined) {
    log.info("resend scancode ...")
    await botClient.callback({eventType:'LOGINSCAN', body: {url: botClient.qrcode}})
  }

  while (botClient.flag) {
    await botClient.tunnel.write(newEventRequest("PING", ""))
    await sleep(10 * 1000)
  }

  botClient.tunnel.end()
}

function sleep(ms) {
  return new Promise(resolve=>{
    setTimeout(resolve, ms)
  })
}

async function main() {
  while(true) {
    try {
      await runEventTunnel(botClient)
    } catch (e) {
      log.error("connection failed, retrying ... ", e)
    }
    await sleep(10 * 1000)
  }
}

if (require.main === module) {
  main()
}

exports.runEventTunnel = runEventTunnel
