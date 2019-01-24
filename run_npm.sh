#!/bin/bash 

docker run -it --rm --net=host \
       -v `pwd`:/home/work \
       --env HTTPS_PROXY=$https_proxy \
       --env HTTP_PROXY=$http_proxy \
       -w /home/work npm:padchat-client "$@"

