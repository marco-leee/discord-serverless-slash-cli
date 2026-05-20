let _env: Env;

export function setEnv(env: Env) {
  _env = env;
}

export function getEnv(): Env {
  return _env;
}
