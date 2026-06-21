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

const SQL_3: &str = r#"
ALTER TABLE proxy_servers ADD COLUMN proxy_type TEXT NOT NULL DEFAULT 'ss';
ALTER TABLE proxy_servers ADD COLUMN username TEXT DEFAULT '';
"#;

const SQL_4: &str = r#"
ALTER TABLE proxy_servers ADD COLUMN vless_uuid TEXT DEFAULT '';
ALTER TABLE proxy_servers ADD COLUMN vless_opts TEXT DEFAULT '';
"#;

const SQL_5: &str = r#"
CREATE TABLE proxy_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    group_type TEXT NOT NULL DEFAULT 'fixed',
    is_active INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE proxy_group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_identifier TEXT NOT NULL,
    server_identifier TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (group_identifier) REFERENCES proxy_groups(identifier) ON DELETE CASCADE,
    FOREIGN KEY (server_identifier) REFERENCES proxy_servers(identifier) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_proxy_groups_active ON proxy_groups(is_active) WHERE is_active = 1;
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
        Migration {
            version: 3,
            description: "add_proxy_type_and_username_to_proxy_servers",
            sql: SQL_3,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_vless_columns_to_proxy_servers",
            sql: SQL_4,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_proxy_groups_tables",
            sql: SQL_5,
            kind: MigrationKind::Up,
        },
    ]
}
