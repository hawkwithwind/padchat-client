#!/bin/bash

docker run -it --rm --net=host \
       -v `pwd`/libs:/home/work/libs \
       -v `pwd`/proto:/home/work/proto \
       -v `pwd`/main.js:/home/work/main.js \
       -v `pwd`/$1/config:/home/work/config \
       -v `pwd`/$1/logs:/home/work/logs \
       -w /home/work padchat-client

