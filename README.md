# padchat-client

thanks to [padchat-sdk](https://github.com/binsee/padchat-sdk), this project just dockerize it, and provide a restful API.

# installation

```
docker build -t npm:padchat-client docker/npm
./run_npm.sh install

docker build -t padchat-client docker/runtime
```

# config

config/config.json
```
{
  "padchatServer": "ws://padchat-sdk.botorange.com"
  , "padchatPort": 8988
  , "padchatToken": "yourtoken"
  , "clientId": "clientid"
  , "hubport": 13142
}
```

# run

```
make dir bot001
mv config/ bot001/
mkdir bot001/logs

./run.sh bot001
```

