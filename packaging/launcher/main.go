// chatbrowser 本地启动器：内嵌前端资源，在固定端口起本地服务并用应用窗口打开。
// 固定端口保证 origin 稳定，IndexedDB/localStorage 数据跨启动保留。
package main

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

//go:embed web
var embedded embed.FS

const (
	addr     = "127.0.0.1:17890"
	port     = 17890
	appURL   = "http://" + addr + "/"
	healthAt = "/__chatbrowser"
)

// version 由构建脚本通过 -ldflags "-X main.version=..." 注入。
var version = "dev"

type healthInfo struct {
	App     string `json:"app"`
	Version string `json:"version"`
}

func main() {
	noOpen := flag.Bool("no-open", false, "启动后不自动打开窗口")
	flag.Parse()

	// 端口上已有本应用实例：同版本直接开窗口；旧版本先结束，避免「新版启动却显示旧界面」。
	if info, ok := probe(); ok {
		if info.App == "chatbrowser" && info.Version != version {
			if !terminateStale() || !waitPortFree(3*time.Second) {
				messageBox("另一个旧版本的对话浏览器仍在运行（端口 " + addr + "）。\n请先关闭它，再重新启动本程序。")
				return
			}
		} else {
			if !*noOpen {
				openWindow()
			}
			return
		}
	}
	if busy() {
		messageBox("端口 " + addr + " 被其他程序占用，无法启动。请关闭占用程序后重试。")
		return
	}

	web, err := fs.Sub(embedded, "web")
	if err != nil {
		messageBox("内置资源缺失：" + err.Error())
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc(healthAt, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(healthInfo{App: "chatbrowser", Version: version})
	})
	// 应用内「退出」：结束本地服务，释放 exe 文件占用。仅允许本机页面调用。
	mux.HandleFunc(healthAt+"/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Host != addr {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
		go func() {
			time.Sleep(200 * time.Millisecond)
			os.Exit(0)
		}()
	})
	mux.Handle("/", serveStatic(web))

	server := &http.Server{Addr: addr, Handler: mux}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	for i := 0; i < 50; i++ {
		if _, ok := probe(); ok {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !*noOpen {
		openWindow()
	}
	select {}
}

func serveStatic(web fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.ToSlash(filepath.Clean("/" + strings.TrimPrefix(r.URL.Path, "/")))
		path := strings.TrimPrefix(clean, "/")
		if path == "" {
			path = "index.html"
		}
		data, err := fs.ReadFile(web, path)
		if err != nil {
			// 单页应用：未知路径回退到 index.html
			path = "index.html"
			data, err = fs.ReadFile(web, path)
			if err != nil {
				http.NotFound(w, r)
				return
			}
		}
		if strings.HasPrefix(path, "static/") {
			// 带内容哈希的资源可长期缓存
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeContent(w, r, path, time.Time{}, bytes.NewReader(data))
	})
}

func busy() bool {
	conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// probe 查询端口上的服务；旧版只返回 "ok"，按未知版本处理。
func probe() (healthInfo, bool) {
	client := http.Client{Timeout: 900 * time.Millisecond}
	resp, err := client.Get(appURL + strings.TrimPrefix(healthAt, "/"))
	if err != nil {
		return healthInfo{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return healthInfo{}, false
	}
	var raw bytes.Buffer
	if _, err := raw.ReadFrom(resp.Body); err != nil {
		return healthInfo{}, false
	}
	body := strings.TrimSpace(raw.String())
	var info healthInfo
	if json.Unmarshal([]byte(body), &info) == nil && info.App != "" {
		return info, true
	}
	if body == "ok" {
		return healthInfo{App: "chatbrowser", Version: ""}, true
	}
	return healthInfo{}, false
}

func waitPortFree(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !busy() {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return !busy()
}

// terminateStale 结束监听固定端口、且进程名为 chatbrowser 的旧实例。
func terminateStale() bool {
	switch runtime.GOOS {
	case "windows":
		script := "$ErrorActionPreference='SilentlyContinue';" +
			"$c=Get-NetTCPConnection -LocalPort " + strconv.Itoa(port) + " -State Listen | Select-Object -First 1;" +
			"if(-not $c){exit 1};" +
			"$p=Get-Process -Id $c.OwningProcess;" +
			"if(-not $p){exit 1};" +
			"if($p.ProcessName -eq 'chatbrowser'){Stop-Process -Id $p.Id -Force;exit 0};" +
			"exit 1"
		encoded := encodePowerShell(script)
		cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded)
		hideWindow(cmd)
		if err := cmd.Run(); err == nil {
			return true
		}
		return false
	case "darwin":
		return killPIDs(listeningPIDs())
	default:
		return killPIDs(listeningPIDs())
	}
}

func listeningPIDs() []int {
	try := func(name string, args ...string) string {
		out, err := exec.Command(name, args...).Output()
		if err != nil {
			return ""
		}
		return string(out)
	}
	var raw string
	if runtime.GOOS == "darwin" {
		raw = try("lsof", "-t", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN")
	} else {
		raw = try("lsof", "-t", "-iTCP:"+strconv.Itoa(port), "-sTCP:LISTEN")
		if raw == "" {
			raw = try("ss", "-ltnp", "sport = :"+strconv.Itoa(port))
			pids := []int{}
			for _, field := range strings.Fields(raw) {
				if idx := strings.Index(field, "pid="); idx >= 0 {
					value := strings.TrimSuffix(field[idx+4:], ",")
					if pid, err := strconv.Atoi(value); err == nil {
						pids = append(pids, pid)
					}
				}
			}
			return pids
		}
	}
	pids := []int{}
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		if pid, err := strconv.Atoi(strings.TrimSpace(line)); err == nil {
			pids = append(pids, pid)
		}
	}
	return pids
}

func killPIDs(pids []int) bool {
	killed := false
	for _, pid := range pids {
		if runtime.GOOS == "linux" {
			exe, err := os.Readlink("/proc/" + strconv.Itoa(pid) + "/exe")
			if err != nil || !strings.Contains(filepath.Base(exe), "chatbrowser") {
				continue
			}
		}
		proc, err := os.FindProcess(pid)
		if err != nil {
			continue
		}
		if proc.Kill() == nil {
			killed = true
		}
	}
	return killed
}

// encodePowerShell 生成 UTF-16LE Base64，避免引号与中文转义问题。
func encodePowerShell(script string) string {
	units := utf16.Encode([]rune(script))
	buf := make([]byte, len(units)*2)
	for i, unit := range units {
		buf[i*2] = byte(unit)
		buf[i*2+1] = byte(unit >> 8)
	}
	return base64.StdEncoding.EncodeToString(buf)
}

// openWindow 优先用 Chromium 系浏览器的 --app 模式开独立窗口，失败则退回默认浏览器。
func openWindow() {
	switch runtime.GOOS {
	case "windows":
		for _, browser := range windowsBrowsers() {
			if tryStart(browser, "--app="+appURL) {
				return
			}
		}
		tryStart("rundll32", "url.dll,FileProtocolHandler", appURL)
	case "darwin":
		if tryStart("open", "-na", "Google Chrome", "--args", "--app="+appURL) {
			return
		}
		tryStart("open", appURL)
	default: // linux 等
		for _, browser := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"} {
			if tryStart(browser, "--app="+appURL) {
				return
			}
		}
		tryStart("xdg-open", appURL)
	}
}

// windowsBrowsers 返回 Edge/Chrome 可执行文件的候选路径（PATH 外还查标准安装目录）。
func windowsBrowsers() []string {
	candidates := []string{}
	add := func(exe string) {
		for _, root := range []string{
			os.Getenv("ProgramFiles(x86)"),
			os.Getenv("ProgramFiles"),
			os.Getenv("LocalAppData"),
		} {
			if root != "" {
				candidates = append(candidates, filepath.Join(root, exe))
			}
		}
	}
	add(`Microsoft\Edge\Application\msedge.exe`)
	add(`Google\Chrome\Application\chrome.exe`)
	candidates = append(candidates, "msedge", "chrome")
	return candidates
}

func tryStart(name string, args ...string) bool {
	path, err := exec.LookPath(name)
	if err != nil {
		return false
	}
	cmd := exec.Command(path, args...)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		return false
	}
	go func() { _ = cmd.Wait() }() // 回收子进程，避免僵尸
	return true
}

func messageBox(text string) {
	fmt.Fprintln(os.Stderr, text)
	if runtime.GOOS != "windows" {
		return
	}
	// 启动器是 GUI 程序，没有控制台；用系统消息框展示错误。
	escaped := strings.ReplaceAll(text, "'", "''")
	script := "Add-Type -AssemblyName PresentationFramework;" +
		"[System.Windows.MessageBox]::Show('" + escaped + "','chatbrowser') | Out-Null"
	tryStart("powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script))
}
