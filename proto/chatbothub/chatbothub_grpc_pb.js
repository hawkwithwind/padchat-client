// GENERATED CODE -- DO NOT EDIT!

// Original file comments:
// Copyright 2015 gRPC authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
'use strict';
var grpc = require('grpc');
var chatbothub_pb = require('./chatbothub_pb.js');

function serialize_chatbothub_BotsReply(arg) {
  if (!(arg instanceof chatbothub_pb.BotsReply)) {
    throw new Error('Expected argument of type chatbothub.BotsReply');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_BotsReply(buffer_arg) {
  return chatbothub_pb.BotsReply.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_chatbothub_BotsRequest(arg) {
  if (!(arg instanceof chatbothub_pb.BotsRequest)) {
    throw new Error('Expected argument of type chatbothub.BotsRequest');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_BotsRequest(buffer_arg) {
  return chatbothub_pb.BotsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_chatbothub_EventReply(arg) {
  if (!(arg instanceof chatbothub_pb.EventReply)) {
    throw new Error('Expected argument of type chatbothub.EventReply');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_EventReply(buffer_arg) {
  return chatbothub_pb.EventReply.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_chatbothub_EventRequest(arg) {
  if (!(arg instanceof chatbothub_pb.EventRequest)) {
    throw new Error('Expected argument of type chatbothub.EventRequest');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_EventRequest(buffer_arg) {
  return chatbothub_pb.EventRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_chatbothub_LoginQQReply(arg) {
  if (!(arg instanceof chatbothub_pb.LoginQQReply)) {
    throw new Error('Expected argument of type chatbothub.LoginQQReply');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_LoginQQReply(buffer_arg) {
  return chatbothub_pb.LoginQQReply.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_chatbothub_LoginQQRequest(arg) {
  if (!(arg instanceof chatbothub_pb.LoginQQRequest)) {
    throw new Error('Expected argument of type chatbothub.LoginQQRequest');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_LoginQQRequest(buffer_arg) {
  return chatbothub_pb.LoginQQRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_chatbothub_LoginWechatReply(arg) {
  if (!(arg instanceof chatbothub_pb.LoginWechatReply)) {
    throw new Error('Expected argument of type chatbothub.LoginWechatReply');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_LoginWechatReply(buffer_arg) {
  return chatbothub_pb.LoginWechatReply.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_chatbothub_LoginWechatRequest(arg) {
  if (!(arg instanceof chatbothub_pb.LoginWechatRequest)) {
    throw new Error('Expected argument of type chatbothub.LoginWechatRequest');
  }
  return new Buffer(arg.serializeBinary());
}

function deserialize_chatbothub_LoginWechatRequest(buffer_arg) {
  return chatbothub_pb.LoginWechatRequest.deserializeBinary(new Uint8Array(buffer_arg));
}


var ChatBotHubService = exports.ChatBotHubService = {
  // bots only use eventtunnel to communicate
  eventTunnel: {
    path: '/chatbothub.ChatBotHub/EventTunnel',
    requestStream: true,
    responseStream: true,
    requestType: chatbothub_pb.EventRequest,
    responseType: chatbothub_pb.EventReply,
    requestSerialize: serialize_chatbothub_EventRequest,
    requestDeserialize: deserialize_chatbothub_EventRequest,
    responseSerialize: serialize_chatbothub_EventReply,
    responseDeserialize: deserialize_chatbothub_EventReply,
  },
  // below are for internal web api
  getBots: {
    path: '/chatbothub.ChatBotHub/GetBots',
    requestStream: false,
    responseStream: false,
    requestType: chatbothub_pb.BotsRequest,
    responseType: chatbothub_pb.BotsReply,
    requestSerialize: serialize_chatbothub_BotsRequest,
    requestDeserialize: deserialize_chatbothub_BotsRequest,
    responseSerialize: serialize_chatbothub_BotsReply,
    responseDeserialize: deserialize_chatbothub_BotsReply,
  },
  loginQQ: {
    path: '/chatbothub.ChatBotHub/LoginQQ',
    requestStream: false,
    responseStream: false,
    requestType: chatbothub_pb.LoginQQRequest,
    responseType: chatbothub_pb.LoginQQReply,
    requestSerialize: serialize_chatbothub_LoginQQRequest,
    requestDeserialize: deserialize_chatbothub_LoginQQRequest,
    responseSerialize: serialize_chatbothub_LoginQQReply,
    responseDeserialize: deserialize_chatbothub_LoginQQReply,
  },
  loginWechat: {
    path: '/chatbothub.ChatBotHub/LoginWechat',
    requestStream: false,
    responseStream: false,
    requestType: chatbothub_pb.LoginWechatRequest,
    responseType: chatbothub_pb.LoginWechatReply,
    requestSerialize: serialize_chatbothub_LoginWechatRequest,
    requestDeserialize: deserialize_chatbothub_LoginWechatRequest,
    responseSerialize: serialize_chatbothub_LoginWechatReply,
    responseDeserialize: deserialize_chatbothub_LoginWechatReply,
  },
};

exports.ChatBotHubClient = grpc.makeGenericClientConstructor(ChatBotHubService);
