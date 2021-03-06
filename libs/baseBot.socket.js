'use strict'

const log4js  = require('log4js')
const Padchat = require('padchat-sdk')
const fs      = require('fs')
const util    = require('util')
const qrcode  = require('qrcode')
const x2j     = require('xml2js')
const uuidv4  = require('uuid/v4')
var   ZabbixSender = require('node-zabbix-sender')
const OSS     = require('ali-oss')
//var sizeof    = require('buffer-image-size')
//const sharp   = require('sharp')

/**
* 创建日志目录
*/

try {
  require('fs').mkdirSync('./logs')
} catch (e) {
  if (e.code !== 'EEXIST') {
    console.error('Could not set up log directory, error: ', e)
    process.exit(1)
  }
}

try {
  require('fs').mkdirSync('./cache')
} catch(e) {
  if (e.code !== 'EEXIST') {
    console.error('Could not set up cache directory, error: ', e)
    process.exit(1)
  }  
}

try {
  log4js.configure('config/log4js.json')
} catch (e) {
  console.error('载入log4js日志输出配置错误: ', e)
  process.exit(1);
}

let parseXml = async (xml) => {
  return new Promise((resolve, reject) => {
    x2j.parseString(xml, {
      explicitArray: false
    }, (error, result) => {
      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    })
  })
}

const logger = log4js.getLogger('app')
const dLog   = log4js.getLogger('dev')

const autoData = {
  userName: '',
  wxData: '',
  token : ''
}

try {
  var loginInfo       = JSON.parse(String(fs.readFileSync('config/login.json')))
      autoData.wxData = loginInfo.wxData
      autoData.token  = loginInfo.token
  logger.info('载入设备参数与自动登陆数据')
} catch (e) {
  logger.warn('没有在本地发现设备登录参数')
}

module.exports = (config, botClient) => {
  let server = `${config.padchatServer}:${config.padchatPort}/${config.padchatToken}`
  logger.info(`connect to server ${server}`)

  var ossClient = null
  
  if (!config.oss) {
    logger.error("cannot read config.oss, ignore")
  } else {
    ossClient = new OSS({
      region: config.oss.region,
      accessKeyId: config.oss.accessKeyId,
      accessKeySecret: config.oss.accessKeySecret,
      bucket: config.oss.bucket,
    })
  }

  let zbx_sender = null
  if (config.zabbix && config.zabbix.server && config.zabbix.port) {  
    zbx_sender = new ZabbixSender({host: config.zabbix.server, port: config.zabbix.port})
    logger.info(`connect to zabbix server ${config.zabbix.server}:${config.zabbix.port}`)
  } else {
    logger.warn('zabbix服务地址未配置，忽略')
  }

  const wx = new Padchat(server)
  wx.sendTimeout = 30 // set time out to 30 seconds, default is 30 * 1000, but inner code will *1000 again, so overide it.
  logger.info('padchat client started')

  let disconnectCount = 0      // 断开计数
  let connected       = false  // 成功连接标志
  
  wx
    .on('close', (code, msg) => {
      // 需要注意关闭代码为3201-3203的错误，重连也用，具体参考文档中`close`事件说明
      if (code > 3200) {
	logger.warn(`Websocket已关闭！code: ${code} - ${msg}`)
	return
      }
      logger.info(`Websocket已关闭！code: ${code} - ${msg}`)
      // 根据是否成功连接过判断本次是未能连接成功还是与服务器连接中断
      if (connected) {
	connected = false
	disconnectCount++
	logger.info(`第 ${disconnectCount} 次与服务器连接断开！现在将重试连接服务器。`)
      } else {
	logger.debug(`未能连接服务器！将重试连接服务器。`)
      }
      // 重新启动websocket连接
      //wx.start()
      logger.info("不会重新连接服务器，正在关闭实例，等待重启")
      process.exit(0)
    })
    .on('open', async () => {
      let ret
      logger.info('连接成功!')
      connected = true

      wx.ws.isAlive = true
      if (wx.ws.pingLoop) {
        logger.info('再次启动，首先清除ping loop')
        try {
          clearInterval(wx.ws.pingLoop)
        } catch (err) {
          logger.error(err)
        }
      }
      
      wx.ws.pingLoop = setInterval(() => {
        if(wx.ws.isAlive === false) {
          if(zbx_sender) {
            //send zabbix alert
            try {
              zbx_sender.addItem(`${config.zabbix.host}`, `${config.zabbix.key}`, 0).send((err, res) => {              
      	        if (err) { throw err }
      	      })
            } catch(e) {
              logger.error(e)
            }
          }
          logger.info('超时未收到pong，退出...')
          wx.close()
      	  return
        }

        wx.ws.isAlive = false
        wx.ws.ping(() => {})
      }, (5 * 60 - 10) * 1000)
      
      wx.ws.on('pong', () => {
      	wx.ws.isAlive = true
        if(zbx_sender) {
          try {
      	    //send zabbix ok
      	    zbx_sender.addItem(`${config.zabbix.host}`, `${config.zabbix.key}`, 1).send((err, res) => {
      	      if (err) { throw err }
              //logger.info('zbx %o', res)
      	    })
          } catch(e) {
            logger.error(e)
          }
        }
      })

      wx.ws.on('close', () => {
      	wx.ws.isAlive = false
        if(zbx_sender) {
          try {
      	    //send zabbix alert
      	    zbx_sender.addItem(`${config.zabbix.host}`, `${config.zabbix.key}`, 0).send((err, res) => {
      	      if (err) { throw err }
      	    })
          } catch(e) {
            logger.error(e)
          }
        }
      	clearInterval(wx.ws.pingLoop)
      })

      logger.info('初始化 1')
      // 非首次登录时最好使用以前成功登录时使用的设备参数，
      // 否则可能会被tx服务器怀疑账号被盗，导致手机端被登出
      ret = await wx.init()
      logger.info('初始化 2')
      
      if (!ret.success) {
	logger.error('新建任务失败', ret)
	return
      }
      logger.info('新建任务成功, json: ', ret)

      //先尝试使用断线重连方式登陆
      if (botClient.loginInfo!==undefined &&
	  botClient.loginInfo.wxData!==undefined &&
	  botClient.loginInfo.wxData.length > 0 &&
	  botClient.loginInfo.token!==undefined &&
	  botClient.loginInfo.token.length > 0 ) {

	logger.info(botClient.loginInfo)
	
	ret = await wx.login('auto', botClient.loginInfo)
	if (ret.success) {
          logger.info('断线重连请求成功', ret)
          return
	}
	logger.warn('断线重连请求失败', ret)

	if (botClient.loginPass !== undefined &&
	    botClient.loginPass.login.length > 0 &&
	    botClient.loginPass.password.length > 0) {
	  logger.info('尝试密码登录')
	  ret = await wx.login('user', {wxData: botClient.loginInfo.wxData,
					username: botClient.loginPass.login,
					password: botClient.loginPass.password})
	  if (ret.success) {
	    logger.info('密码登录成功', ret)
	    return
	  }
	  logger.warn('密码登录失败', ret)
	} else {
	  ret = await wx.login('request', botClient.loginInfo)
	  if (ret.success) {
            logger.info('自动登录请求成功', ret)
            return
	  }
	  logger.warn('自动登录请求失败', ret)
	}
      } else {
	logger.warn('未提供设备登录参数')
      }

      ret = await wx.login('qrcode')
      if (!ret.success) {
	logger.error('使用qrcode登录模式失败！', ret)
        logger.info('shut down ...')
        process.exit(0)
	return
      }
      logger.info('使用qrcode登录模式！')
    })
    .on('qrcode', async (data) => {
      // 如果存在url，则直接在终端中生成二维码并显示
      if (data.url) {
	logger.info(`登陆二维码内容为: "${data.url}"，请使用微信扫描下方二维码登陆!`)
	let qr = await qrcode.toDataURL(data.url)

        botClient.qrcode = qr
	botClient.callback({eventType:'LOGINSCAN', body: {url: qr}})
		
	// qrcode.generate(data.url, { small: false } ,function(qr) {
	//   botClient.callback({eventType:'LOGINSCAN', body: {url: `data:image/png;base64, ${qr}`}})
	// })
      } else {
	logger.error(`未能获得登陆二维码`)
      }
    })
    .on('scan', data => {
      switch (data.status) {
      case 0:
        logger.info('等待扫码...', data)
        break;
      case 1:
        // {
        //   status     : 1,
        //   expiredTime: 239,
        //   headUrl    : 'http://wx.qlogo.cn/mmhead/ver_1/xxxxxxx/0', //头像url
        //   nickName   : '木匠' //昵称
        // }
        logger.info('已扫码，请在手机端确认登陆...', data)
        botClient.qrcode = "CONFIRM_ON_PHONE"
        botClient.callback({eventType:'LOGINSCAN', body: {url: botClient.qrcode}})
        break;
      case 2:
        // {
        //   password   : '***hide***',   // 可忽略
        //   status     : 2,
        //   expiredTime: 238,
        //   headUrl    : 'http://wx.qlogo.cn/mmhead/ver_1/xxxxxxx/0',  //头像url
        //   subStatus  : 0               // 登陆操作状态码
        //   以下字段仅在登录成功时有效
        //   external   : '1',
        //   email      : '',
        //   uin        : 149806460,      // 微信账号uin，全局唯一
        //   deviceType : 'android',      // 登陆的主设备类型
        //   nickName   : '木匠'          //昵称
        //   userName   : 'wxid_xxxxxx',  // 微信账号id，全局唯一
        //   phoneNumber: '18012345678',  // 微信账号绑定的手机号
        // }        
        switch (data.subStatus) {
        case 0:
          botClient.callback({eventType:'CONTACTINFO', body: {userName: data.userName, nickName: data.nickName, smallHead: data.headUrl} })
          
          logger.info('扫码成功！登陆成功！', data)
          break;
        case 1:
          logger.info('扫码成功！登陆失败！', data)
          break;
        default:
          logger.info('扫码成功！未知状态码！', data)
          break;
        }
        break;
	// 如果等待登陆超时或手机上点击了取消登陆，需要重新调用登陆
      case 3:
        logger.info('二维码已过期！请重新调用登陆接口！', data)
        botClient.callback({eventType:'LOGOUTDONE', body:data})
        logger.info('shut down ...')
        process.exit(0)
        break;
      case 4:
        logger.info('手机端已取消登陆！请重新调用登陆接口！', data)
        botClient.callback({eventType:'LOGOUTDONE', body:data})
        logger.info('shut down ...')
        process.exit(0)
        break;
      default:
        logger.warn('未知登陆状态！请重新调用登陆接口！', data)
        botClient.callback({eventType:'LOGOUTDONE', body:data})
        logger.info('shut down ...')
        process.exit(0)
        break;
      }
    })
    .on('login', async () => {
      logger.info('微信账号登陆成功！')
      let ret = await wx.getMyInfo()
      logger.info('当前账号信息：', ret.data)
      botClient.loginData = ret.data

      // 主动同步通讯录
      await wx.syncContact()
      await saveAutoData(botClient)

      botClient.logindone()
    })
    .on('autoLogin', async () => {
      // 自动重连后需要保存新的自动登陆数据
      logger.info('update token')
      await saveAutoData(botClient)
      botClient.callback({eventType:'UPDATETOKEN', body:{
	userName: botClient.loginData.userName,
	token: botClient.loginInfo.token,
      }})
    })
    .on('logout', ({ msg }) => {
      logger.info('微信账号已退出！', msg)
      botClient.callback({eventType:'LOGOUTDONE', body:msg})
      logger.info('shut down ...')
      process.exit(0)
    })    
    .on('over', ({ msg }) => {
      logger.info('任务实例已关闭！', msg)
      // 此时不应该登出，应该重启后服务器通知重连
      //botClient.callback({eventType:'LOGOUTDONE', body:msg})
      logger.info('shut down ...')
      process.exit(0)
    })
    .on('loaded', async () => {
      logger.info('通讯录同步完毕！')

      botClient.callback({eventType:'CONTACTSYNCDONE', body:{}})

      // 主动触发同步消息
      await wx.syncMsg()

      const ret = await wx.sendMsg('filehelper', '你登录了！')
      logger.info('发送信息结果：', ret)
    })
    .on('sns', (data, msg) => {
      logger.info('收到朋友圈事件！请查看朋友圈新消息哦！', msg)
    })
    .on('contact', async data => {
      logger.info('收到推送联系人：%s - %s', data.userName, data.nickName)
    })
    .on('push', async data => {
      // 消息类型 data.mType
      // 1  文字消息
      // 2  好友信息推送，包含好友，群，公众号信息
      // 3  收到图片消息
      // 34  语音消息
      // 35  用户头像buf
      // 37  收到好友请求消息
      // 42  名片消息
      // 43  视频消息
      // 47  表情消息
      // 48  定位消息
      // 49  APP消息(文件 或者 链接 H5)
      // 50  语音通话
      // 51  状态通知（如打开与好友/群的聊天界面）
      // 52  语音通话通知
      // 53  语音通话邀请
      // 62  小视频
      // 2000  转账消息
      // 2001  收到红包消息
      // 3000  群邀请
      // 9999  系统通知
      // 10000  微信通知信息. 微信群信息变更通知，多为群名修改，进群，离群信息，不包含群内聊天信息
      // 10002  撤回消息
      // --------------------------------
      // 注意，如果是来自微信群的消息，data.content字段中包含发言人的wxid及其发言内容，需要自行提取
      // 各类复杂消息，data.content中是xml格式的文本内容，需要自行从中提取各类数据。（如好友请求）
      let rawFile
      switch (data.mType) {
      case 3:
        logger.info('收到来自 %s 的图片消息，包含图片数据：%s，xml内容：\n%s', data.fromUser, !!data.data, data.content)
        rawFile = data.data || null
        if (!rawFile || rawFile === null) {
          logger.info('图片消息 data.data 为空, 停止处理')
          let debugId = botClient.loginData.username + "-debug-" + uuidv4()
          fs.writeFileSync(`cache/${debugId}`, data)
          break
        }
        
        logger.info('图片缩略图数据base64尺寸：%d', rawFile.length)
        let thumbnail = rawFile
        
        await wx.getMsgImage(data)
          .then(ret => {
	    logger.info("%d %s", ret.status, ret.message)
            rawFile = ret.data.image || ''
            logger.info('获取消息原始图片结果：%s, 获得图片base64尺寸：%d',
                        ret.success, rawFile.length)
          })
        logger.info('图片数据base64尺寸：%d', rawFile.length)

	if(data.content && data.fromUser) {
	  if (/@chatroom$/.test(data.fromUser)) {
	    data['groupId'] = data.fromUser
	    data['fromUser'] = data.content.substr(0, data.content.indexOf(':\n'))
	    data['content'] = data.content.substr(data.content.indexOf(':\n') + 2)
	  } else if (/@chatroom$/.test(data.toUser)) {
            data['groupId'] = data.toUser
          }
	}
	
	/*
          await wx.sendImage('filehelper', rawFile)
          .then(ret => {
          logger.info('转发图片信息给 %s 结果：', 'filehelper', ret)
          })
          .catch(e => {
          logger.warn('转发图片信息异常:', e.message)
          })
	*/

        let imageId = botClient.loginData.userName + "-" + uuidv4()
        let imagePath = `cache/${imageId}`
        let thumbPath = `cache/${imageId}-thumbnail`

        data.imageId = imageId
        data.thumbnailId = `${imageId}-thumbnail`
        
        /*
        let img = Buffer.from(rawFile, 'base64')
        let dimensions = sizeof(img)
        let imgWidth   = dimensions.width
        let imgHeight  = dimensions.height

        let scaleWidth = imgWidth
        if (scaleWidth > 400) {
          scaleWidth = 400
        }

        let thumbimg = await sharp(img)
            .resize({width: scaleWidth})
            .toBuffer()
        */
                
        if (ossClient) {
          try {
            logger.info(`上传缩略图至aliyun oss... chathub/images/${imageId}-thumbnail`)
            let thumbresult = await ossClient.put(`chathub/images/${imageId}-thumbnail`, Buffer.from(thumbnail, 'base64'))
            if (thumbresult.res && thumbresult.res.status == 200) {
              logger.info(`上传图片 ${thumbresult.name} 完成`)
            } else {
              logger.error('上传图片返回', thumbresult)
            }
          } catch(err) {
            logger.error('上传缩略图失败', err)
          }
        }

        /*
        fs.writeFile(thumbPath, thumbimg, (err) => {
          if (err) {
            logger.error(`写入缩略图 ${thumbPath} 失败`)
          } else {
            logger.info(`写入缩略图 ${thumbPath} 成功`)
          }          
        })
        */
        
	fs.writeFile(imagePath, rawFile, (err) => {
          if (err) {
            logger.error('写入图片文件 ' + imagePath + '失败', err)
          } else {
            logger.info('写入图片文件 ' + imagePath)
	    logger.info('rawFile %d', rawFile.length)
	    logger.info(rawFile.substr(0, 80))
          }
        })

        if (ossClient) {
          logger.info(`上传图片至aliyun oss... chathub/images/${imageId}`)
          ossClient.put(`chathub/images/${imageId}`, Buffer.from(rawFile, 'base64')).then(result=>{
            if(result.res && result.res.status == 200) {
              logger.info(`上传图片 ${result.name} 完成`)
            } else {
              logger.info('上传图片返回', result)
            }
          }).catch(err=>{
            logger.error('上传图片失败', err)
          })
        }
	
	botClient.callback({eventType:'IMAGEMESSAGE', body: data})
        break
        
      case 43:
        logger.info('收到来自 %s 的视频消息，包含视频数据：%s，xml内容：\n%s', data.fromUser, !!data.data, data.content)
        rawFile = data.data || null
        if (!rawFile) {
          await wx.getMsgVideo(data)
            .then(ret => {
              rawFile = ret.data.video || ''
              logger.info('获取消息原始视频结果：%s, 获得视频base64尺寸：%d', ret.success, rawFile.length)
            })
        }
        logger.info('视频数据base64尺寸：%d', rawFile.length)
        break

      case 1:
        if (data.fromUser === 'newsapp') { // 腾讯新闻发的信息太长
          break
        }
        logger.info('收到来自 %s 的文本消息：', data.fromUser, data.description || data.content)

        if (/ding/.test(data.content)) {
          // await wx.sendMsg(data.fromUser, 'dong. receive:' + data.content)
          //   .then(ret => {
          //     logger.info('回复信息给%s 结果：', data.fromUser, ret)
          //   })
          //   .catch(e => {
          //     logger.warn('回复信息异常:', e.message)
          //   })
        } else if (/^#.*/.test(data.content) || /^[\w]*:\n#.*/.test(data.content)) {
          await onMsg(data)
            .catch(e => {
              logger.warn('处理信息异常：', e)
            })
	}
      
        break
	
      case 2:
	logger.info('收到来自 %s 的联系人消息', data.fromUser)
	//botClient.callback({eventType:'CONTACTINFO', body:data})
	break

      case 10000:
	logger.info('收到群变更消息', data)
	//botClient.callback({eventType:'GROUPINFO', body:data})
	break

      case 34:
        logger.info('收到来自 %s 的语音消息，包含语音数据：%s，xml内容：\n%s', data.fromUser, !!data.data, data.content)
        // 超过30Kb的语音数据不会包含在推送信息中，需要主动拉取
        rawFile = data.data || null
        if (!rawFile) {
          // BUG: 超过60Kb的语音数据，只能拉取到60Kb，
          // 也就是说大约36~40秒以上的语音会丢失后边部分语音内容
          await wx.getMsgVoice(data)
            .then(ret => {
              rawFile = ret.data.voice || ''
              logger.info('获取消息原始语音结果：%s, 获得语音base64尺寸：%d，拉取到数据尺寸：%d', ret.success, rawFile.length, ret.data.size)
            })
        }
        logger.info('语音数据base64尺寸：%d', rawFile.length)
        if (rawFile.length > 0) {
          let   match  = data.content.match(/length="(\d+)"/) || []
          const length = match[1] || 0
          match  = data.content.match(/voicelength="(\d+)"/) || []
          const ms     = match[1] || 0
          logger.info('语音数据语音长度：%d ms，xml内记录尺寸：%d', ms, length)

          await wx.sendVoice('filehelper', rawFile, ms)
            .then(ret => {
              logger.info('转发语音信息给 %s 结果：', 'filehelper', ret)
            })
            .catch(e => {
              logger.warn('转发语音信息异常:', e.message)
            })
        }
        break

      case 49:

        if (data.content.indexOf('<![CDATA[微信红包]]>') > 0) {
          logger.info('收到来自 %s 的红包：', data.fromUser, data)
          await wx.queryRedPacket(data)
            .then(ret => {
              logger.info('未领取，查询来自 %s 的红包信息：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('未领取，查询红包异常:', e.message)
            })
          await wx.receiveRedPacket(data)
            .then(async ret => {
              logger.info('接收来自 %s 的红包结果：', data.fromUser, ret)
              await wx.openRedPacket(data, ret.data.key)
                .then(ret2 => {
                  logger.info('打开来自 %s 的红包结果：', data.fromUser, ret2)
                })
                .catch(e => {
                  logger.warn('打开红包异常:', e.message)
                })
              await wx.queryRedPacket(data)
                .then(ret => {
                  logger.info('打开后，查询来自 %s 的红包信息：', data.fromUser, ret)
                })
                .catch(e => {
                  logger.warn('打开后，再次查询红包异常:', e.message)
                })
            })
            .catch(e => {
              logger.warn('接收红包异常:', e.message)
            })
        } else if (data.content.indexOf('<![CDATA[微信转账]]>') > 0) {
          logger.info('收到来自 %s 的转账：', data.fromUser, data)
          await wx.queryTransfer(data)
            .then(ret => {
              logger.info('查询来自 %s 的转账信息：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('查询转账异常:', e.message)
            })
          await wx.acceptTransfer(data)
            .then(ret => {
              logger.info('接受来自 %s 的转账结果：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('接受转账异常:', e.message)
            })
          await wx.queryTransfer(data)
            .then(ret => {
              logger.info('接受后，查询来自 %s 的转账信息：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('接受后，查询转账异常:', e.message)
            })
        } else {
          logger.info('收到一条来自 %s 的appmsg富媒体消息：', data.fromUser, data)
        }
        break

      case 37:
	logger.info('收到好友请求', data)
	botClient.callback({eventType:'FRIENDREQUEST', body:data})
	break

      case 10002:
        if (data.fromUser === 'weixin') {
          //每次登陆，会收到一条系统垃圾推送，过滤掉
          break
        }
        logger.info('用户 %s 撤回了一条消息：', data.fromUser, data)
        break

      default:
        logger.info('收到推送消息：', data)
        break
      }
    })
    .on('error', e => {
      logger.error('ws 错误:', e.message)
    })
    .on('warn', e => {
      logger.error('任务出现错误:', e.message)
    })

  /**
   * @description 保存自动登陆数据
   */
  async function saveAutoData(botClient) {
    let ret = await wx.getWxData()
    if (!ret.success) {
      logger.warn('获取设备参数未成功！ json:', ret)
      return
    }
    //logger.info('获取设备参数成功, json: ', ret)
    Object.assign(autoData, { wxData: ret.data.wxData })

    ret = await wx.getLoginToken()
    if (!ret.success) {
      logger.warn('获取自动登陆数据未成功！ json:', ret)
      return
    }
    //logger.info('获取自动登陆数据成功, json: ', ret)
    Object.assign(autoData, { token: ret.data.token })
    Object.assign(autoData, { userName: botClient.loginData.userName })

    // NOTE: 这里将设备参数保存到本地，以后再次登录此账号时提供相同参数
    fs.writeFileSync('config/login.json', JSON.stringify(autoData, null, 2))
    logger.info('设备参数已写入到 config/login.json文件')

    botClient.loginInfo = autoData;
  }

  async function onMsg(data) {
    const content        = data.content.replace(/^[\w:\n]*#/m, '')
    let   [cmd, ...args] = content.split('\n')

    args = args.map(str => {
      try {
	str = JSON.parse(str)
      } catch (e) {
      }
      return str
    })
    if (cmd && wx[cmd] && typeof wx[cmd] === 'function') {
      logger.info('执行函数 %s，参数：', cmd, args)
      await wx[cmd](...args)
	.then(ret => {
          logger.info('执行函数 %s 结果：%o', cmd, ret)
	})
	.catch(e => {
          logger.warn('执行函数 %s 异常：', e)
	})
    }
  }

  process.on('uncaughtException', e => {
    logger.error('Main', 'uncaughtException:', e)
    process.exit(1)
  })

  process.on('unhandledRejection', e => {
    logger.error('Main', 'unhandledRejection:', e)
    process.exit(1)
  })

  return wx
}
