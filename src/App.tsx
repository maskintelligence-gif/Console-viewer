import { useState, useEffect, useRef, useMemo } from "react";
import { io, Socket } from "socket.io-client";
import { Terminal, Play, Loader2, AlertCircle, Info, AlertTriangle, Trash2, Copy, Download, Check, ChevronDown, ChevronUp, Search, Activity, Camera, History, Bug, Maximize, Share2, X } from "lucide-react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { motion, AnimatePresence } from "motion/react";

interface LogEntry {
  type: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  timestamp: string;
  args?: string[];
}

interface NetworkEntry {
  url: string;
  status: number;
  method: string;
  type: string;
  errorText?: string;
  timestamp: string;
}

interface ScanHistory {
  id: number;
  url: string;
  timestamp: string;
  error_count: number;
  warn_count: number;
}

const LogItem = ({ log, index, copiedIndex, copyToClipboard, url }: { log: LogEntry; index: number; copiedIndex: number | null; copyToClipboard: (text: string, index: number) => void; url: string }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = log.text.length > 300 || (log.args && log.args.join(" ").length > 300);

  const getLogColor = (type: string) => {
    switch (type) {
      case "error": return "text-red-400 bg-red-900/20 border-l-2 border-red-500";
      case "warn": return "text-yellow-400 bg-yellow-900/20 border-l-2 border-yellow-500";
      case "info": return "text-blue-400 bg-blue-900/20 border-l-2 border-blue-500";
      default: return "text-gray-300 border-l-2 border-gray-700";
    }
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case "error": return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "warn": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "info": return <Info className="w-4 h-4 text-blue-500" />;
      default: return <span className="w-4 h-4" />;
    }
  };

  const generateBugReport = () => {
    const md = `## Bug Report\n**URL:** ${url}\n**Timestamp:** ${new Date(log.timestamp).toLocaleString()}\n**Level:** ${log.type.toUpperCase()}\n\n**Error Message:**\n\`\`\`text\n${log.text}\n\`\`\`\n\n${log.args && log.args.length > 0 ? `**Additional Args:**\n\`\`\`json\n${JSON.stringify(log.args, null, 2)}\n\`\`\`` : ""}`;
    navigator.clipboard.writeText(md);
    alert("Bug report copied to clipboard (Markdown format)!");
  };

  return (
    <div className={`group flex gap-3 p-2 rounded-sm ${getLogColor(log.type)} relative pr-16 mb-1`}>
      <div className="mt-0.5 shrink-0">{getLogIcon(log.type)}</div>
      <div className="flex-1 min-w-0">
        <div className={`break-all ${!expanded && isLong ? "line-clamp-3" : ""}`}>
          <span className="opacity-90">{log.text}</span>
          {log.args && log.args.length > 0 && (
            <div className="mt-1 pl-2 border-l border-white/10 text-zinc-400">
              {log.args.join(" ")}
            </div>
          )}
        </div>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" /> Show Less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Show More
              </>
            )}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 self-start absolute right-2 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/80 p-1 rounded backdrop-blur-sm">
        <button
          onClick={generateBugReport}
          className="p-1 hover:bg-black/40 rounded text-zinc-400 hover:text-red-400"
          title="1-Click Bug Report"
        >
          <Bug className="w-3 h-3" />
        </button>
        <button
          onClick={() => copyToClipboard(`${log.text} ${log.args ? log.args.join(' ') : ''}`, index)}
          className="p-1 hover:bg-black/40 rounded text-zinc-400 hover:text-white"
          title="Copy"
        >
          {copiedIndex === index ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
};

export default function App() {
  const [url, setUrl] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [networkLogs, setNetworkLogs] = useState<NetworkEntry[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [historyList, setHistoryList] = useState<ScanHistory[]>([]);
  
  const [isScanning, setIsScanning] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [filter, setFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [activeTab, setActiveTab] = useState<"console" | "network" | "snapshots" | "history">("console");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const logBufferRef = useRef<LogEntry[]>([]);
  const networkBufferRef = useRef<NetworkEntry[]>([]);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      setHistoryList(data);
    } catch (e) {
      console.error("Failed to fetch history", e);
    }
  };

  useEffect(() => {
    fetchHistory();
    
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("console-log", (log: LogEntry) => {
      logBufferRef.current.push(log);
    });

    newSocket.on("network-log", (net: NetworkEntry) => {
      networkBufferRef.current.push(net);
    });

    newSocket.on("screenshot", (base64: string) => {
      setScreenshot(base64);
    });

    newSocket.on("scan-complete", () => {
      setIsScanning(false);
      fetchHistory(); // Refresh history after scan
    });

    const interval = setInterval(() => {
      if (logBufferRef.current.length > 0) {
        setLogs((prev) => [...prev, ...logBufferRef.current]);
        logBufferRef.current = [];
      }
      if (networkBufferRef.current.length > 0) {
        setNetworkLogs((prev) => [...prev, ...networkBufferRef.current]);
        networkBufferRef.current = [];
      }
    }, 100);

    return () => {
      clearInterval(interval);
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (logs.length > 0 && activeTab === "console") {
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: logs.length - 1, align: "end", behavior: "auto" });
      }, 50);
    }
  }, [logs.length, activeTab]);

  const handleScan = () => {
    if (!url) return;
    if (!url.startsWith("http")) {
      alert("Please enter a valid URL starting with http:// or https://");
      return;
    }
    setLogs([]);
    setNetworkLogs([]);
    setScreenshot(null);
    logBufferRef.current = [];
    networkBufferRef.current = [];
    setIsScanning(true);
    setActiveTab("console");
    socket?.emit("scan-url", url);
  };

  const loadHistory = async (id: number) => {
    try {
      const res = await fetch(`/api/history/${id}`);
      const data = await res.json();
      setUrl(data.url);
      setLogs(data.logs || []);
      setNetworkLogs(data.network || []);
      setScreenshot(data.screenshot || null);
      setActiveTab("console");
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filter !== "all") {
        if (filter === "error" && log.type !== "error") return false;
        if (filter === "warn" && log.type !== "warn") return false;
        if (filter === "info" && log.type !== "info" && log.type !== "log") return false;
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const textMatch = log.text.toLowerCase().includes(query);
        const argsMatch = log.args?.some(arg => arg.toLowerCase().includes(query));
        if (!textMatch && !argsMatch) return false;
      }
      return true;
    });
  }, [logs, filter, searchQuery]);

  const copyToClipboard = (text: string, index?: number) => {
    navigator.clipboard.writeText(text);
    if (index !== undefined) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const copyAllLogs = () => {
    const text = filteredLogs.map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.text} ${l.args ? l.args.join(' ') : ''}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const downloadLogs = () => {
    const data = JSON.stringify(filteredLogs, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const urlObj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlObj;
    a.download = `console-logs-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlObj);
  };

  const downloadSnapshot = () => {
    if (!screenshot) return;
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${screenshot}`;
    a.download = `snapshot-${new Date().toISOString()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const shareSnapshot = async () => {
    if (!screenshot) return;
    try {
      const base64Data = `data:image/png;base64,${screenshot}`;
      const blob = await (await fetch(base64Data)).blob();
      const file = new File([blob], `snapshot-${new Date().toISOString()}.png`, { type: 'image/png' });
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Console Viewer Snapshot',
          text: `Check out this snapshot of ${url}`,
          files: [file]
        });
      } else {
        alert("Sharing files is not supported on this browser. You can download it instead.");
      }
    } catch (error) {
      console.error("Error sharing:", error);
    }
  };

  const TabButton = ({ active, onClick, icon, label, badge }: any) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-t-2 transition-colors ${
        active ? "border-indigo-500 text-white bg-zinc-900/50" : "border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/20"
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-800 text-[10px] text-zinc-300">
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-gray-200 font-sans p-4 md:p-8 flex flex-col">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
            <Terminal className="w-6 h-6 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Console Viewer Pro</h1>
        </div>
        <div className="text-xs text-zinc-500 font-mono">v2.0.0</div>
      </header>

      <main className="flex-1 flex flex-col gap-4 max-w-6xl mx-auto w-full h-[calc(100vh-10rem)]">
        {/* Input Section */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 shadow-sm shrink-0">
          <div className="flex flex-col gap-3">
            <input
              type="url"
              placeholder="Enter website URL (e.g., https://example.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 placeholder-zinc-600 transition-all"
            />
            <button
              onClick={handleScan}
              disabled={isScanning || !url}
              className="w-full justify-center px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-indigo-900/20"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Run Scan
                </>
              )}
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-2xl shadow-black/50 min-h-0">

          {/* Tab Content: Console */}
          {activeTab === "console" && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0 gap-3">
                <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
                  <button onClick={() => setFilter("all")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${filter === "all" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>All</button>
                  <button onClick={() => setFilter("error")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${filter === "error" ? "bg-red-900/30 text-red-400" : "text-zinc-500 hover:text-zinc-300"}`}>Errors</button>
                  <button onClick={() => setFilter("warn")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${filter === "warn" ? "bg-yellow-900/30 text-yellow-400" : "text-zinc-500 hover:text-zinc-300"}`}>Warnings</button>
                  <button onClick={() => setFilter("info")} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${filter === "info" ? "bg-blue-900/30 text-blue-400" : "text-zinc-500 hover:text-zinc-300"}`}>Info</button>
                  <div className="h-6 w-px bg-zinc-800 mx-2 hidden md:block"></div>
                  <div className="relative flex-1 md:w-64 min-w-[150px]">
                    <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-zinc-500" />
                    <input type="text" placeholder="Filter logs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-8 pr-3 py-1 text-xs focus:outline-none focus:border-zinc-700 placeholder-zinc-600 transition-all" />
                  </div>
                </div>
                <div className="flex items-center gap-1 self-end md:self-auto">
                  <button onClick={copyAllLogs} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors" title="Copy All">{copiedAll ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}</button>
                  <button onClick={downloadLogs} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors" title="Download JSON"><Download className="w-4 h-4" /></button>
                  <div className="w-px h-4 bg-zinc-800 mx-1" />
                  <button onClick={() => { setLogs([]); logBufferRef.current = []; }} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors" title="Clear Console"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex-1 font-mono text-xs custom-scrollbar bg-zinc-950">
                {filteredLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                    <Terminal className="w-8 h-8 opacity-20" />
                    <p>No logs to display</p>
                  </div>
                ) : (
                  <Virtuoso
                    ref={virtuosoRef}
                    data={filteredLogs}
                    followOutput="auto"
                    itemContent={(index, log) => (
                      <LogItem log={log} index={index} copiedIndex={copiedIndex} copyToClipboard={copyToClipboard} url={url} />
                    )}
                    className="custom-scrollbar"
                    style={{ height: "100%" }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Tab Content: Network */}
          {activeTab === "network" && (
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-zinc-950">
              {networkLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                  <Activity className="w-8 h-8 opacity-20" />
                  <p>No network activity recorded</p>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="text-zinc-500 border-b border-zinc-800 bg-zinc-900/80 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2 font-medium w-24">Status</th>
                      <th className="px-4 py-2 font-medium w-24">Method</th>
                      <th className="px-4 py-2 font-medium w-32">Type</th>
                      <th className="px-4 py-2 font-medium">URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50 font-mono">
                    {networkLogs.map((net, i) => (
                      <tr key={i} className="hover:bg-zinc-900/50 transition-colors">
                        <td className={`px-4 py-2 ${net.status >= 400 || net.status === 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {net.status === 0 ? 'FAILED' : net.status}
                        </td>
                        <td className="px-4 py-2 text-zinc-400">{net.method}</td>
                        <td className="px-4 py-2 text-zinc-500">{net.type}</td>
                        <td className="px-4 py-2 truncate max-w-[200px] md:max-w-md lg:max-w-xl text-zinc-300" title={net.url}>
                          {net.url}
                          {net.errorText && <div className="text-red-400 text-[10px] mt-1">{net.errorText}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab Content: Snapshots */}
          {activeTab === "snapshots" && (
            <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
              {screenshot ? (
                <>
                  <div className="flex items-center justify-end px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0 gap-2">
                    <button onClick={() => setIsPreviewOpen(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors">
                      <Maximize className="w-4 h-4" /> Full Preview
                    </button>
                    <button onClick={downloadSnapshot} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors">
                      <Download className="w-4 h-4" /> Download
                    </button>
                    <button onClick={shareSnapshot} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-600/30 transition-colors border border-indigo-500/20">
                      <Share2 className="w-4 h-4" /> Share
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 flex justify-center items-start custom-scrollbar">
                    <img 
                      src={`data:image/png;base64,${screenshot}`} 
                      alt="Page Snapshot" 
                      className="max-w-full rounded-lg border border-zinc-800 shadow-2xl cursor-zoom-in"
                      onClick={() => setIsPreviewOpen(true)}
                    />
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2 w-full">
                  <Camera className="w-8 h-8 opacity-20" />
                  <p>No snapshot available. Run a scan first.</p>
                </div>
              )}
            </div>
          )}

          {/* Tab Content: History */}
          {activeTab === "history" && (
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-zinc-950">
              {historyList.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                  <History className="w-8 h-8 opacity-20" />
                  <p>No scan history yet</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {historyList.map(h => (
                    <div key={h.id} onClick={() => loadHistory(h.id)} className="flex items-center justify-between p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl hover:border-indigo-500/50 hover:bg-zinc-900/80 transition-all cursor-pointer group">
                      <div className="min-w-0 flex-1 pr-4">
                        <div className="font-medium text-zinc-200 truncate" title={h.url}>{h.url}</div>
                        <div className="flex items-center gap-4 mt-2 text-xs">
                          <span className="text-zinc-500">{new Date(h.timestamp).toLocaleString()}</span>
                          <div className="flex gap-3">
                            <span className="text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {h.error_count}</span>
                            <span className="text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {h.warn_count}</span>
                          </div>
                        </div>
                      </div>
                      <button className="px-4 py-2 bg-zinc-800 group-hover:bg-indigo-600 group-hover:text-white rounded-lg text-xs font-medium transition-colors shrink-0">
                        Load Scan
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tabs (Bottom) */}
          <div className="flex overflow-x-auto no-scrollbar border-t border-zinc-800 bg-zinc-900/30 px-2 shrink-0">
            <TabButton active={activeTab === "console"} onClick={() => setActiveTab("console")} icon={<Terminal className="w-4 h-4" />} label="Console" badge={logs.length} />
            <TabButton active={activeTab === "network"} onClick={() => setActiveTab("network")} icon={<Activity className="w-4 h-4" />} label="Network" badge={networkLogs.length} />
            <TabButton active={activeTab === "snapshots"} onClick={() => setActiveTab("snapshots")} icon={<Camera className="w-4 h-4" />} label="Snapshot" />
            <TabButton active={activeTab === "history"} onClick={() => setActiveTab("history")} icon={<History className="w-4 h-4" />} label="History" />
          </div>
        </div>
      </main>

      {/* Full Preview Modal */}
      <AnimatePresence>
        {isPreviewOpen && screenshot && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 md:p-8"
            onClick={() => setIsPreviewOpen(false)}
          >
            <button 
              className="absolute top-4 right-4 p-2 bg-zinc-800/50 hover:bg-zinc-700 rounded-full text-white transition-colors"
              onClick={() => setIsPreviewOpen(false)}
            >
              <X className="w-6 h-6" />
            </button>
            <img 
              src={`data:image/png;base64,${screenshot}`} 
              alt="Full Preview" 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
