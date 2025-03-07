# Testing

For now, only testing the outcome of running the CLI is supported. Before running tests, make sure that you have installed and started Docker. 

In order to test locally you can run the following command:

1. ```bash
$ docker run -it --rm --name verdaccio -p 4873:4873 verdaccio/verdaccio
```

2. ```bash
$ cp .verdaccio/conf/config.yaml verdaccio:/verdaccio/conf/config.yaml
```
   - Setups verdaccio to allow only our packages to be published only locally, any other packages can be only installed.

3. ```bash
$ docker restart verdaccio
```

4. ```bash
$ ./scripts/e2e-publish.ts
```
   - Modifies yarnrc to point to the local registry, publishes the package, and then restores the original yarnrc.

5. ```bash
$ yarn workspace @actor-core/cli run test
```
   - Runs the tests for the CLI, which includes running the CLI (inside Docker) with different arguments and checking the output.