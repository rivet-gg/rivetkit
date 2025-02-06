#!/bin/sh

curl -X POST -d '{ "query": { "getOrCreateForTags": { "tags": { "name": "counter" }, "create": { "tags": { "name": "counter" } } } } }' http://localhost:8787/manager/actors

