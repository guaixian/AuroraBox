use tauri_plugin_sql::{Migration, MigrationKind};

// 定义一个 sql_1 的变量 来存储 SQL 语句

const SQL_1: &str = r#"
CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,  -- 唯一标识符，自动生成的UUID hex值
    name TEXT,                        -- 订阅名称
    used_traffic INTEGER DEFAULT 0,   -- 已用流量(字节)，默认值为0
    total_traffic INTEGER DEFAULT 1,  -- 总流量(字节)，默认值为1
    subscription_url TEXT,            -- 订阅地址
    official_website TEXT,            -- 官网地址
    expire_time INTEGER DEFAULT (strftime('%s', 'now', '+30 days')),  -- 过期时间，默认为30天后
    last_update_time INTEGER DEFAULT (strftime('%s', 'now'))          -- 最近更新时间，默认为当前时间
);
-- 创建配置文件表
CREATE TABLE subscription_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,         -- 对应subscriptions表的identifier
    config_content TEXT,              -- YAML格式的配置文件内容
    FOREIGN KEY (identifier) REFERENCES subscriptions(identifier) ON DELETE CASCADE
);

-- 确保外键约束生效
PRAGMA foreign_keys = ON;
"#;

const SQL_2: &str = r#"
CREATE TABLE proxy_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    server_address TEXT NOT NULL,
    server_port INTEGER NOT NULL,
    password TEXT NOT NULL,
    encryption_method TEXT NOT NULL,
    plugin TEXT DEFAULT '',
    plugin_opts TEXT DEFAULT '',
    is_active INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE UNIQUE INDEX idx_proxy_servers_active ON proxy_servers(is_active) WHERE is_active = 1;
"#;

pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: SQL_1,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_proxy_servers_table",
            sql: SQL_2,
            kind: MigrationKind::Up,
        },
    ]
}
