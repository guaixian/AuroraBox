# Changelog

{{version-tag-date}}

## Changes since v1.4.28

All significant changes in this version are documented here.

### Changes

- Updated sing-box core to v1.13.13.
- Updated JavaScript and Rust dependencies.
- Attempted to stop processes occupying ports and improved prompts.
- Added `make update PORT=...` proxy support for dependency and binary updates.
- Added a developer option to start VPN in non-TUN mode without setting the system proxy.
- Changed TUN DNS override to prepend the TUN gateway DNS instead of replacing existing DNS servers.

### Bug Fixes

- Fixed TUN shutdown so it removes only the inserted gateway DNS and preserves the user's other DNS servers.

## 自 v1.4.28 以来的变更

本版本的所有重要变更将记录于此。

### 变更

- 更新 JavaScript 与 Rust 依赖。
- 更新 sing-box 内核至 v1.13.13。
- 尝试停止端口占用的进程，并改进提示。
- 新增开发者选项：非 TUN 模式启动 VPN 时可不设置系统代理。
- 新增 `make update PORT=...` 代理端口支持，用于依赖和二进制更新。
- TUN DNS 覆写改为将 TUN 网关 DNS 放在第一位，而不是替换掉现有 DNS 服务器。


### Bug 修复

- 修复 TUN 关闭时的 DNS 恢复逻辑，现在只删除插入的网关 DNS，并保留用户的其他 DNS 服务器。

---

> 请确保您了解潜在风险后再使用开发版和测试版。
>
> Use development and beta versions only if you are aware of the potential risks.

## v1.0.4

### Fixed
- Fixed power/connection icon not rendering on Windows (replaced Unicode glyph with SVG)
- Fixed latency and speed testing on Windows — temp path now uses Windows-compatible directory,
  curl commands suppress console window, and `/dev/null` replaced with `nul`
- Fixed incomplete Chinese/English language switching — all settings page labels now translated
- Fixed DevTools (F12) not respecting developer mode toggle — keyboard shortcut now gated
- Fixed switching from Global proxy to TUN mode while proxy running causing errors —
  TUN↔SystemProxy mode changes now perform full stop+restart cycle
- Fixed tray menu mode switching to use stop+start when TUN state changes

### Improved
- Settings page fully internationalized with proper translation keys
- Developer mode changes now apply immediately without requiring app restart
- Linux RPM packages now uploaded alongside DEB in CI releases

**修复和新增功能：**
- 修复 Windows 主页连接图标丢失问题（Unicode → SVG）
- 修复 Windows 延迟/速度测试失败（临时路径、控制台窗口、设备路径适配）
- 修复中英文切换不完整，设置界面全部使用翻译 key
- 修复 F12 开发者工具未受设置开关控制
- 修复全局代理切换 TUN 模式报错（TUN↔SystemProxy 切换改为完整停止+启动）
- 修复托盘菜单模式切换 TUN 状态变更时的同样问题
- 设置界面完整国际化，开发者模式即时生效
- CI Release 增加 Linux RPM 包上传
