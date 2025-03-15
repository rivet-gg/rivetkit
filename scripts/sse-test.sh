#!/bin/sh

curl -X POST -d '{ "query": { "getOrCreateForTags": { "tags": { "name": "counter" }, "create": { "tags": { "name": "counter" } } } } }' http://localhost:6420/manager/actors

