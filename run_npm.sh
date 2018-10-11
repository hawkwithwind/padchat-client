#!/bin/bash

docker run -it --rm --net=host -v `pwd`:/home/work -w /home/work npm:padchat-client "$@"

