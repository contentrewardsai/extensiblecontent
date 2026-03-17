"use client";

import { useState } from "react";
import "./styles/demo.css";

const BROWSER_TABS = [
  { tab: "1", url: "https://www.pexels.com/search/nature/", favicon: "🔗", title: "Pexels – Free Stock Photos" },
  { tab: "2", url: "about:blank", favicon: "📄", title: "New tab" },
  { tab: "3", url: "chrome-extension://.../generator/index.html", favicon: "📐", title: "Text Ad - Apple Notes" },
];

const EXTENSION_PANELS = ["plan", "pulse", "activity", "library"] as const;

export default function Page() {
  const [activeExtensionPanel, setActiveExtensionPanel] = useState<typeof EXTENSION_PANELS[number]>("plan");
  const [activeBrowserTab, setActiveBrowserTab] = useState("1");

  const activeTabData = BROWSER_TABS.find((t) => t.tab === activeBrowserTab);

  return (
    <div className="demo-page">
      <header className="demo-header">
        <h1>Extensible Content</h1>
        <p>Chrome extension demo — side panel + workflow on a stock-photo style page</p>
      </header>

      <div className="browser-frame" role="presentation" aria-label="Mock browser window with extension">
        <div className="browser-chrome">
          <div className="browser-dots" aria-hidden="true">
            <span className="dot dot-red" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </div>
          <div className="browser-tabs">
            {BROWSER_TABS.map((t) => (
              <button
                key={t.tab}
                type="button"
                className={`browser-tab ${activeBrowserTab === t.tab ? "active" : ""}`}
                data-tab={t.tab}
                data-url={t.url}
                onClick={() => setActiveBrowserTab(t.tab)}
              >
                <span className="tab-favicon">{t.favicon}</span>
                <span className="tab-title">{t.title}</span>
              </button>
            ))}
            <div className="browser-tab browser-tab-add" aria-label="New tab">+</div>
          </div>
          <div className="browser-address-bar">
            <span className="address-lock" aria-hidden="true">🔒</span>
            <span className="address-url" id="browser-url">{activeTabData?.url ?? ""}</span>
          </div>
        </div>

        <div className="browser-content">
          <div className="browser-pages">
            <div className={`browser-page ${activeBrowserTab === "1" ? "active" : ""}`} id="fake-page" data-page="1">
              <div className="fake-page-header">
                <h2>Nature</h2>
                <p>Free stock photos & videos you can use anywhere</p>
              </div>
              <div className="fake-gallery" role="list">
                {["nature1", "nature2", "nature3", "nature4", "nature5", "nature6", "nature7", "nature8", "nature9"].map((seed, i) => (
                  <div key={seed} className="fake-gallery-item" role="listitem">
                    <img src={`https://picsum.photos/seed/${seed}/400/400`} alt={["Nature stock", "Mountain landscape", "Forest", "Ocean", "Sunset", "Flowers", "Beach", "Sky", "Waterfall"][i]} loading="lazy" />
                  </div>
                ))}
              </div>
            </div>

            <div className={`browser-page browser-page-blank ${activeBrowserTab === "2" ? "active" : ""}`} data-page="2">
              <div className="browser-page-blank-inner">
                <p>New tab</p>
              </div>
            </div>

            <div className={`browser-page browser-page-generator ${activeBrowserTab === "3" ? "active" : ""}`} data-page="3">
              <div className="gen-page-layout">
                <aside className="gen-sidebar">
                  <h2 className="gen-sidebar-title">GENERATOR</h2>
                  <div className="gen-block">
                    <label className="gen-label">TEMPLATE</label>
                    <select className="gen-select" disabled>
                      <option>Text Ad - Apple Notes</option>
                    </select>
                    <p className="gen-hint">From generator/templates/. Bulk create fills data into the selected template.</p>
                    <p className="gen-hint">Apple Notes-style card: window header (red/yellow/green), note title, and body text on cream background. ShotStack text assets support effects like typewriter. Export as PNG.</p>
                  </div>
                  <div className="gen-block">
                    <span className="gen-label">Edit</span>
                    <div className="gen-btn-row">
                      <button type="button" className="gen-btn" disabled>Undo</button>
                      <button type="button" className="gen-btn" disabled>Redo</button>
                      <button type="button" className="gen-btn" disabled>Copy</button>
                      <button type="button" className="gen-btn" disabled>Paste</button>
                    </div>
                  </div>
                  <div className="gen-block">
                    <span className="gen-label">Add</span>
                    <div className="gen-btn-grid">
                      <button type="button" className="gen-btn" disabled>Add text</button>
                      <button type="button" className="gen-btn" disabled>Add image</button>
                      <button type="button" className="gen-btn" disabled>Add shape</button>
                      <button type="button" className="gen-btn" disabled>Add video</button>
                      <button type="button" className="gen-btn" disabled>Add audio</button>
                      <button type="button" className="gen-btn" disabled>Import SVG</button>
                      <button type="button" className="gen-btn" disabled>Import JSON</button>
                    </div>
                  </div>
                  <div className="gen-block">
                    <span className="gen-label">LAYERS</span>
                    <ul className="gen-layer-list">
                      <li>Background</li>
                      <li>Body</li>
                      <li>Note Title</li>
                      <li>shape_circle_2</li>
                    </ul>
                  </div>
                  <div className="gen-block gen-toolbar">
                    <button type="button" className="gen-btn" disabled>Import ShotStack JSON</button>
                    <button type="button" className="gen-btn" disabled>Export ShotStack JSON</button>
                    <button type="button" className="gen-btn" disabled>Bulk create</button>
                    <button type="button" className="gen-btn" disabled>From workflow</button>
                    <button type="button" className="gen-btn" disabled>From scheduled</button>
                    <button type="button" className="gen-btn" disabled>Save</button>
                    <button type="button" className="gen-btn" disabled>Version History</button>
                    <button type="button" className="gen-btn" disabled>Save as new template</button>
                    <button type="button" className="gen-btn" disabled>Save to project folder</button>
                  </div>
                  <p className="gen-footer-link">Open sidebar panel</p>
                </aside>
                <div className="gen-preview-area">
                  <div className="gen-output-bar">
                    <span>Output:</span>
                    <select className="gen-select-inline" disabled><option>Image</option></select>
                    <span>Fit</span>
                    <span>1080 × 1080 Res:</span>
                    <select className="gen-select-inline" disabled><option>Instagram square (1:1)</option></select>
                    <span>Zoom:</span>
                    <button type="button" className="gen-btn gen-btn-sm" disabled>Save as JSON</button>
                    <button type="button" className="gen-btn gen-btn-sm" disabled>Refresh</button>
                    <button type="button" className="gen-btn gen-btn-sm" disabled>Export as PNG</button>
                  </div>
                  <div className="gen-canvas-wrap gen-ad-card-wrap">
                    <div className="ad-card note-style">
                      <div className="note-header">
                        <div className="note-buttons">
                          <span className="note-btn btn-red" aria-hidden="true" />
                          <span className="note-btn btn-yellow" aria-hidden="true" />
                          <span className="note-btn btn-green" aria-hidden="true" />
                        </div>
                      </div>
                      <div id="noteTitle">Content Rewards AI</div>
                      <div id="textPreview">Introducing Extensible Content: The Ultimate Platform to Craft Compelling Content that Drives Revenue!</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="extension-panel" aria-label="Extensible Content side panel (demo)">
            <div className="extension-header">
              <span className="extension-title">Extensible Content</span>
            </div>
            <div className="demo-logged-in">
              <p className="demo-user-row">
                <strong>support@contentrewardsai.com</strong>
                <span className="demo-pro-badge">PRO</span>
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Log out</button>
                <span className="demo-status-dot" aria-hidden="true" title="Connected" />
              </p>
              <div className="demo-toolbar-row">
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled title="Reload Extension">Reload</button>
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small demo-set" disabled title="Set project folder">Set folder</button>
                <span className="demo-set-status">✓ Set</span>
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Tests</button>
              </div>
              <div className="demo-sidebar-name-row">
                <label htmlFor="demo-sidebar-name"><strong>Sidebar Name:</strong></label>
                <input type="text" id="demo-sidebar-name" className="ext-input" placeholder="e.g. Office PC, Laptop" disabled />
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Save</button>
              </div>
              <div className="demo-project-row">
                <label htmlFor="demo-project-select"><strong>Project:</strong></label>
                <select id="demo-project-select" className="ext-select demo-project-select" disabled>
                  <option>New Project</option>
                </select>
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled aria-label="Add new project">+</button>
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Edit</button>
                <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Save</button>
              </div>
              <div className="demo-add-project-form">
                <label htmlFor="demo-new-project-name">Project Name</label>
                <input type="text" id="demo-new-project-name" className="ext-input" placeholder="New project name" disabled />
                <label htmlFor="demo-new-project-industry">Industry</label>
                <select id="demo-new-project-industry" className="ext-select" disabled>
                  <option value="">— Select Industry (Optional) —</option>
                </select>
                <div className="demo-add-project-platforms">
                  <span className="demo-form-heading">Your platforms</span>
                  <p className="ext-hint">Where you create or publish content.</p>
                  <div className="demo-checkbox-group">
                    {["Newsletter", "Other", "Quora", "Reddit", "SnapChat", "bluesky", "facebook", "instagram", "linkedin", "pinterest", "threads", "tiktok", "twitter", "youtube"].map((p) => (
                      <label key={p}><input type="checkbox" disabled /> {p}</label>
                    ))}
                  </div>
                </div>
                <div className="demo-add-project-monetization">
                  <span className="demo-form-heading">What are you selling?</span>
                  <p className="ext-hint">Select one or more.</p>
                  <div className="demo-checkbox-group">
                    {["Ads", "Affiliate Marketing", "Book Sales", "Course Sales", "Physical Products", "Selling Leads", "Services", "Software/SAAS Sales"].map((m) => (
                      <label key={m}><input type="checkbox" disabled /> {m}</label>
                    ))}
                  </div>
                </div>
                <div className="demo-add-project-actions">
                  <button type="button" className="ext-btn ext-btn-primary" disabled>Save</button>
                  <button type="button" className="ext-btn ext-btn-outline" disabled>Cancel</button>
                </div>
              </div>
            </div>
            <nav className="extension-tabs" role="tablist" aria-label="Extension sections">
              {EXTENSION_PANELS.map((panel) => (
                <button
                  key={panel}
                  type="button"
                  className={`ext-tab ${activeExtensionPanel === panel ? "active" : ""}`}
                  role="tab"
                  aria-selected={activeExtensionPanel === panel}
                  data-panel={panel}
                  onClick={() => setActiveExtensionPanel(panel)}
                >
                  {panel.charAt(0).toUpperCase() + panel.slice(1)}
                </button>
              ))}
            </nav>
            <div className="extension-panels">
              <section className={`ext-panel ${activeExtensionPanel === "plan" ? "active" : ""}`} id="panel-plan" role="tabpanel" aria-labelledby="tab-plan">
                <div className="demo-llm-chat">
                  <h3>Local AI Chat</h3>
                  <div className="demo-llm-messages" aria-hidden="true" />
                  <div className="demo-llm-row">
                    <textarea className="ext-textarea" rows={2} placeholder="Ask for headlines, banner ad copy, sales messaging…" disabled />
                    <button type="button" className="ext-btn ext-btn-primary" disabled>Send</button>
                  </div>
                </div>
                <div className="demo-add-workflow">
                  <h3>Add / Edit Workflow</h3>
                  <div className="ext-workflow-row">
                    <select className="ext-select" disabled>
                      <option>+ New workflow...</option>
                      <option>Extract &amp; generate (demo)</option>
                    </select>
                  </div>
                  <div className="demo-new-workflow-row">
                    <input type="text" className="ext-input" placeholder="Workflow name" disabled />
                    <button type="button" className="ext-btn ext-btn-primary" disabled>Create</button>
                  </div>
                  <div className="ext-workflow-row" style={{ marginTop: 10 }}>
                    <label>Workflow</label>
                    <select className="ext-select" disabled>
                      <option>Extract &amp; generate (demo)</option>
                    </select>
                  </div>
                </div>
                <details className="ext-details" open>
                  <summary>Data</summary>
                  <p className="ext-hint">Paste CSV/JSON or import. Columns map to workflow variables.</p>
                  <textarea className="ext-textarea" rows={2} placeholder="Paste CSV or JSON…" disabled />
                </details>
                <div className="ext-steps-block">
                  <h3>Steps <span className="ext-step-count">4</span>
                    <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Record workflow</button>
                  </h3>
                  <ul className="ext-steps-list demo-steps-list">
                    <li className="demo-step-item"><span className="step-type">goToUrl</span> Open page <button type="button" className="step-remove" disabled aria-label="Remove step">×</button></li>
                    <li className="demo-step-item"><span className="step-type">extractData</span> Extract image list <button type="button" className="step-remove" disabled aria-label="Remove step">×</button></li>
                    <li className="demo-step-item"><span className="step-type">runGenerator</span> Create video per row <button type="button" className="step-remove" disabled aria-label="Remove step">×</button></li>
                    <li className="demo-step-item"><span className="step-type">delayBeforeNextRun</span> Delay 15–25s <button type="button" className="step-remove" disabled aria-label="Remove step">×</button></li>
                  </ul>
                  <p className="ext-hint" style={{ marginTop: 6 }}>+ Add step</p>
                </div>
                <div className="ext-btn-group">
                  <button type="button" className="ext-btn ext-btn-play" disabled>Run All Rows</button>
                  <button type="button" className="ext-btn ext-btn-outline" disabled>Run Current Row</button>
                  <button type="button" className="ext-btn ext-btn-outline" disabled>Schedule run</button>
                </div>
              </section>
              <section className={`ext-panel ${activeExtensionPanel === "pulse" ? "active" : ""}`} id="panel-pulse" role="tabpanel" aria-hidden={activeExtensionPanel !== "pulse"}>
                <h3>Pulse</h3>
                <div className="demo-trends-row pulse-icon-row">
                  <a href="https://trends.google.com/trending" target="_blank" rel="noopener noreferrer" className="pulse-icon-link" title="Google Trends – Trending now">
                    <svg className="pulse-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
                    <span className="pulse-icon-label">Google Trends</span>
                  </a>
                  <a href="https://ads.tiktok.com/business/creativecenter/inspiration/popular/pc/en" target="_blank" rel="noopener noreferrer" className="pulse-icon-link" title="TikTok Trends – Hot content on TikTok">
                    <svg className="pulse-icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" /></svg>
                    <span className="pulse-icon-label">TikTok Trends</span>
                  </a>
                  <a href="https://www.facebook.com/watch/topic" target="_blank" rel="noopener noreferrer" className="pulse-icon-link" title="Facebook Trends – Interest topic directory in Video">
                    <svg className="pulse-icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
                    <span className="pulse-icon-label">Facebook Trends</span>
                  </a>
                  <a href="https://x.com/explore?lang=en" target="_blank" rel="noopener noreferrer" className="pulse-icon-link" title="X (Twitter) Trends – Explore">
                    <svg className="pulse-icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                    <span className="pulse-icon-label">X (Twitter) Trends</span>
                  </a>
                  <a href="https://trends.pinterest.com/" target="_blank" rel="noopener noreferrer" className="pulse-icon-link" title="Pinterest Trends">
                    <svg className="pulse-icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.214 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" /></svg>
                    <span className="pulse-icon-label">Pinterest Trends</span>
                  </a>
                  <a href="https://www.reddit.com/r/popular/" target="_blank" rel="noopener noreferrer" className="pulse-icon-link" title="Reddit (Popular)">
                    <svg className="pulse-icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484 1.105 3.467 1.105.984 0 2.625-.263 3.467-1.105a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.547-1.691.73-2.556.73-1.026 0-2.031-.246-2.556-.73a.326.326 0 0 0-.232-.095z" /></svg>
                    <span className="pulse-icon-label">Reddit (Popular)</span>
                  </a>
                </div>
                <div className="demo-section">
                  <div className="demo-section-head">
                    <h4>Following:</h4>
                    <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Add New</button>
                  </div>
                  <div className="demo-following-list">
                    <div className="demo-profile-item">John Doe</div>
                  </div>
                </div>
                <div className="demo-section">
                  <div className="demo-section-head">
                    <h4>Connected: <span className="demo-count">(14 / 20)</span></h4>
                    <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Add New</button>
                  </div>
                  <button type="button" className="ext-btn ext-btn-outline ext-btn-small" disabled>Connect Accounts</button>
                </div>
              </section>
              <section className={`ext-panel ${activeExtensionPanel === "activity" ? "active" : ""}`} id="panel-activity" role="tabpanel" aria-hidden={activeExtensionPanel !== "activity"}>
                <h3>Activity</h3>
                <div className="demo-activity-section">
                  <h4>Upcoming &amp; in progress</h4>
                  <p className="demo-activity-empty">No scheduled runs.</p>
                </div>
                <div className="demo-activity-section">
                  <h4>Workflow run history</h4>
                  <p className="demo-activity-empty">No runs yet.</p>
                </div>
                <div className="demo-activity-section">
                  <h4>Live activity (Socket.IO)</h4>
                  <p className="demo-socket-status"><span className="demo-dot demo-dot-connected" /> Connected</p>
                </div>
                <div className="demo-activity-section">
                  <h4>Your connected sidebars</h4>
                  <div className="demo-sidebar-list">
                    <div className="demo-sidebar-item"><span className="demo-dot demo-dot-offline" /> Unnamed <span className="demo-sidebar-meta">Offline</span></div>
                    <div className="demo-sidebar-item"><span className="demo-dot demo-dot-connected" /> Unnamed <span className="demo-sidebar-meta">Connected</span></div>
                  </div>
                </div>
              </section>
              <section className={`ext-panel ${activeExtensionPanel === "library" ? "active" : ""}`} id="panel-library" role="tabpanel" aria-hidden={activeExtensionPanel !== "library"}>
                <h3>Library</h3>
                <div className="demo-library-section">
                  <h4>Content Generator</h4>
                  <p className="ext-hint">Open the Content Generator in a new tab to create content.</p>
                  <button type="button" className="ext-btn ext-btn-outline" disabled>Content Generator</button>
                </div>
                <div className="demo-library-section">
                  <h4>Projects</h4>
                  <p className="ext-hint">Click a project to open its uploads folder — then add subfolders, upload files, or download.</p>
                  <div className="demo-project-list">
                    <div className="demo-project-item">
                      <span className="demo-project-name">Local (default)</span>
                      <span className="demo-project-sublabel">default</span>
                    </div>
                    <div className="demo-project-item">New Project</div>
                  </div>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>

      <footer className="demo-footer">
        <p>This is a static demo. Install the extension to use workflows, extract data, and generate content.</p>
      </footer>
    </div>
  );
}
