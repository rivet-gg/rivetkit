# Config Types

## Inferred types 

- All types must be included in `ActorTypes` so the user can hardcode types

- If using input parameters for inferring types, they must be raw parameters. e.g.:

    ```typescript
    // It's hard for users to infer TConnParams
    onAuth: (opts: OnAuthOpts<TConnParams>) => TAuthData,
    // Because you would have to import & use an extra type
    onAuth: (opts: OnAuthOpts<MyConnParam>) => TAuthData,
    ```

- When inferring via return data, you must use a union. e.g.:

    ```typescript
    { state: TState } | { createState: () => TState } | undefined
    ```

