// chatbrowser 本地启动器：内嵌前端资源，在固定端口起本地服务并用应用窗口打开。
// 固定端口保证 origin 稳定，IndexedDB/localStorage 数据跨启动保留。
package main

import (
	"bytes"
	"embed"
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
	"strings"
	"time"
)

//go:embed web
var embedded embed.FS

const (
	addr     = "127.0.0.1:17890"
	appURL   = "http://" + addr + "/"
	healthAt = "/__chatbrowser"
)

func main() {
	noOpen := flag.Bool("no-open", false, "启动后不自动打开窗口")
	flag.Parse()

	// 已在运行（端口就绪且健康检查通过）：直接开窗口，避免重复起服务。
	if healthy() {
		if !*noOpen {
			openWindow()
		}
		return
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
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("/", serveStatic(web))

	server := &http.Server{Addr: addr, Handler: mux}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	for i := 0; i < 50 && !healthy(); i++ {
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

func healthy() bool {
	client := http.Client{Timeout: 700 * time.Millisecond}
	resp, err := client.Get(appURL + strings.TrimPrefix(healthAt, "/"))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	buf := make([]byte, 2)
	n, _ := resp.Body.Read(buf)
	return n == 2 && string(buf) == "ok"
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
	if err := cmd.Start(); err != nil {
		return false
	}
	go func() { _ = cmd.Wait() }() // 回收子进程，避免僵尸
	return true
}

func messageBox(text string) {
	fmt.Fprintln(os.Stderr, text)
	if runtime.GOOS == "windows" {
		tryStart("cmd", "/c", "echo "+text+" & pause")
	}
}
