//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow 防止从 GUI 启动器拉起控制台程序时闪出黑框。
func hideWindow(cmd *exec.Cmd) {
	const createNoWindow = 0x08000000
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
