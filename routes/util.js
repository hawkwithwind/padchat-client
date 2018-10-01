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

router.get('/echo', function(req, resp){
  resp_o = {
    headers:req.headers,
    protocol:req.protocol,
    query:req.query,
    baseUrl:req.baseUrl,
    originalUrl:req.originalUrl,
    method:req.method
  }
  resp.send(str(resp_o));
});

module.exports = router;
