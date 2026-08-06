import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { cliExecutionPath, resolveCliExecutable } from './cli-path'

export interface ProcessResult {
  stdout: string
  stderr: string
}

export function runProcess(
  executable: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { input?: string; onStderr?: (text: string) => void } = {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const { input, onStderr, ...spawnOptions } = options
    const isCli = executable === 'claude' || executable === 'codex'
    const resolvedExecutable = isCli ? resolveCliExecutable(executable) : executable
    const env = isCli ? { ...process.env, ...spawnOptions.env, PATH: cliExecutionPath(resolvedExecutable, spawnOptions.env?.PATH) } : spawnOptions.env
    const child = spawn(resolvedExecutable, args, {
      ...spawnOptions,
      env,
      windowsHide: true,
      shell: process.platform === 'win32' && isCli
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => { stdout += data })
    child.stderr.on('data', (data: string) => {
      stderr += data
      onStderr?.(data)
    })
    child.on('error', (error) => reject(new Error(`Impossible de lancer ${executable}: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${executable} s’est arrêté avec le code ${code}. ${stderr.trim() || stdout.trim()}`))
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}
