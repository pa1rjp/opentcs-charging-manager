import fs from 'fs'
import path from 'path'
import { AppConfig, AppConfigSchema } from '../config/schema'
import { DEFAULT_CONFIG } from '../config/defaults'

class ConfigStore {
  private config: AppConfig
  private filePath: string

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath)
    this.config = this.load()
  }

  private load(): AppConfig {
    if (!fs.existsSync(this.filePath)) {
      console.info(`[ConfigStore] config file not found at ${this.filePath}, using defaults`)
      this.persist(DEFAULT_CONFIG)
      return DEFAULT_CONFIG
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      const result = AppConfigSchema.safeParse(parsed)

      if (!result.success) {
        console.warn(
          `[ConfigStore] config validation failed, using defaults:\n${result.error.message}`
        )
        return DEFAULT_CONFIG
      }

      return result.data
    } catch (err) {
      console.warn(`[ConfigStore] failed to read config file, using defaults:`, err)
      return DEFAULT_CONFIG
    }
  }

  private persist(config: AppConfig): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error(`[ConfigStore] failed to write config file:`, err)
    }
  }

  get(): AppConfig {
    return this.config
  }

  set(config: AppConfig): void {
    this.config = config
    this.persist(config)
  }

  update(partial: Partial<AppConfig>): AppConfig {
    const merged = { ...this.config, ...partial }
    const result = AppConfigSchema.safeParse(merged)
    if (!result.success) {
      throw new Error(`Invalid config update: ${result.error.message}`)
    }
    this.set(result.data)
    return result.data
  }
}

// Singleton instance
let instance: ConfigStore | null = null

export function getConfigStore(): ConfigStore {
  if (!instance) {
    const filePath = process.env.CONFIG_FILE ?? './config.json'
    instance = new ConfigStore(filePath)
  }
  return instance
}

export { ConfigStore }
