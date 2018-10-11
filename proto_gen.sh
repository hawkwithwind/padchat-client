#!/bin/bash

grpc_tools_node_protoc -I `pwd`/proto/chatbothub \
		       --js_out=import_style=commonjs,binary:`pwd`/proto/chatbothub/ \
		       --grpc_out=`pwd`/proto/chatbothub/ \
		       --plugin=protoc-gen-grpc=`which grpc_tools_node_protoc_plugin` \
		       `pwd`/proto/chatbothub/chatbothub.proto
