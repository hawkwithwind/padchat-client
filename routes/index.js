'use strict'

var express = require('express');
var router  = express.Router();

function censor(censor) {
  var i = 0;
  
  return function(key, value) {
    if(i !== 0 && typeof(censor) === 'object' && typeof(value) == 'object' && censor == value) 
      return '[Circular]'; 
    
    if(i >= 29) // seems to be a harded maximum of 30 serialized objects?
      return '[Unknown]';
    
    ++i; // so we know we aren't using the original object anymore
    return value;  
  }
}

function str(o) {
  return JSON.stringify(o, censor(o));
}

router.get('/', function(req, res) {
  res.send('hello, world!');
});

async function sendMessageByWxid(req, res) {
  try {
    var bot = req.app.get('bot');
    var result = await bot.sendMsg(req.query.wxid, req.query.message, []);
    return str({sender: req.query, receiver: result});
  } catch (e) {
    var weblog = req.app.get('weblog');
    weblog.error("failed to send message to %o ", req.query, e);
    return str(e);
  }
}

router.get('/send', function(req, res) {
  sendMessageByWxid(req, res).then(function(result){
    res.send(result);
  });
});

module.exports = router;
