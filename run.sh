#!/bin/bash

docker run -d --rm --net=host --name $1 \
       -v `pwd`/libs:/home/work/libs \
       -v `pwd`/proto:/home/work/proto \
       -v `pwd`/node_modules:/home/work/node_modules \
       -v `pwd`/package.json:/home/work/package.json \
       -v `pwd`/package-lock.json:/home/work/package-lock.json \
       -v `pwd`/main.js:/home/work/main.js \
       -v `pwd`/$1/config:/home/work/config \
       -v `pwd`/$1/logs:/home/work/logs \
       -w /home/work padchat-client

