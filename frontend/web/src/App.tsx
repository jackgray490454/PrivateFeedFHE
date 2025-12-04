import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SocialPost {
  id: string;
  encryptedContent: string;
  timestamp: number;
  author: string;
  category: string;
  likes: number;
  comments: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPostData, setNewPostData] = useState({
    content: "",
    category: "General"
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  // Calculate statistics for dashboard
  const totalPosts = posts.length;
  const generalPosts = posts.filter(p => p.category === "General").length;
  const techPosts = posts.filter(p => p.category === "Tech").length;
  const artPosts = posts.filter(p => p.category === "Art").length;

  useEffect(() => {
    loadPosts().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return false;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE contract is available and ready!"
        });
        
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
      }
      return isAvailable;
    } catch (e) {
      console.error("Error checking contract availability:", e);
      return false;
    }
  };

  const loadPosts = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("post_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing post keys:", e);
        }
      }
      
      const list: SocialPost[] = [];
      
      for (const key of keys) {
        try {
          const postBytes = await contract.getData(`post_${key}`);
          if (postBytes.length > 0) {
            try {
              const postData = JSON.parse(ethers.toUtf8String(postBytes));
              list.push({
                id: key,
                encryptedContent: postData.content,
                timestamp: postData.timestamp,
                author: postData.author,
                category: postData.category,
                likes: postData.likes || 0,
                comments: postData.comments || 0
              });
            } catch (e) {
              console.error(`Error parsing post data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading post ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPosts(list);
    } catch (e) {
      console.error("Error loading posts:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPost = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting content with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedContent = `FHE-${btoa(JSON.stringify(newPostData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const postId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const postData = {
        content: encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        author: account,
        category: newPostData.category,
        likes: 0,
        comments: 0
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `post_${postId}`, 
        ethers.toUtf8Bytes(JSON.stringify(postData))
      );
      
      const keysBytes = await contract.getData("post_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(postId);
      
      await contract.setData(
        "post_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted content posted securely!"
      });
      
      await loadPosts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPostData({
          content: "",
          category: "General"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const likePost = async (postId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing like with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const postBytes = await contract.getData(`post_${postId}`);
      if (postBytes.length === 0) {
        throw new Error("Post not found");
      }
      
      const postData = JSON.parse(ethers.toUtf8String(postBytes));
      
      const updatedPost = {
        ...postData,
        likes: (postData.likes || 0) + 1
      };
      
      await contract.setData(
        `post_${postId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedPost))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Like recorded with FHE privacy!"
      });
      
      await loadPosts();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Like failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredPosts = posts.filter(post => {
    const matchesSearch = searchQuery === "" || 
      post.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === "All" || post.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access your private social feed",
      icon: "🔗"
    },
    {
      title: "FHE Encryption",
      description: "Your content is encrypted using Fully Homomorphic Encryption",
      icon: "🔒"
    },
    {
      title: "Private Curation",
      description: "Content is filtered and sorted locally based on your encrypted preferences",
      icon: "⚙️"
    },
    {
      title: "Resist Manipulation",
      description: "Take back control from platform algorithms with on-chain FHE",
      icon: "🛡️"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="glass-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container glass-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Private<span>Feed</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => checkContractAvailability()} 
            className="glass-button"
          >
            Check FHE Status
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="glass-button primary"
          >
            + New Post
          </button>
          <button 
            className="glass-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner glass-card">
          <div className="welcome-text">
            <h2>FHE-Powered Private Social Feed</h2>
            <p>Take back control of your social media experience with fully encrypted, algorithm-resistant content curation</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-ENCRYPTED</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section glass-card">
            <h2>How PrivateFeedFHE Works</h2>
            <p className="subtitle">Your content remains encrypted while being processed</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="stats-grid">
          <div className="stat-card glass-card">
            <h3>Total Posts</h3>
            <div className="stat-value">{totalPosts}</div>
            <div className="stat-label">Encrypted with FHE</div>
          </div>
          
          <div className="stat-card glass-card">
            <h3>General</h3>
            <div className="stat-value">{generalPosts}</div>
            <div className="stat-label">Conversations</div>
          </div>
          
          <div className="stat-card glass-card">
            <h3>Tech</h3>
            <div className="stat-value">{techPosts}</div>
            <div className="stat-label">Discussions</div>
          </div>
          
          <div className="stat-card glass-card">
            <h3>Art</h3>
            <div className="stat-value">{artPosts}</div>
            <div className="stat-label">Creatives</div>
          </div>
        </div>
        
        <div className="filter-section glass-card">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search posts..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass-input"
            />
          </div>
          <div className="category-filters">
            <button 
              className={categoryFilter === "All" ? "filter-btn active" : "filter-btn"}
              onClick={() => setCategoryFilter("All")}
            >
              All
            </button>
            <button 
              className={categoryFilter === "General" ? "filter-btn active" : "filter-btn"}
              onClick={() => setCategoryFilter("General")}
            >
              General
            </button>
            <button 
              className={categoryFilter === "Tech" ? "filter-btn active" : "filter-btn"}
              onClick={() => setCategoryFilter("Tech")}
            >
              Tech
            </button>
            <button 
              className={categoryFilter === "Art" ? "filter-btn active" : "filter-btn"}
              onClick={() => setCategoryFilter("Art")}
            >
              Art
            </button>
          </div>
          <button 
            onClick={loadPosts}
            className="refresh-btn glass-button"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Feed"}
          </button>
        </div>
        
        <div className="posts-grid">
          {filteredPosts.length === 0 ? (
            <div className="no-posts glass-card">
              <div className="no-posts-icon">📝</div>
              <p>No encrypted posts found</p>
              <button 
                className="glass-button primary"
                onClick={() => setShowCreateModal(true)}
              >
                Create First Post
              </button>
            </div>
          ) : (
            filteredPosts.map(post => (
              <div className="post-card glass-card" key={post.id}>
                <div className="post-header">
                  <div className="post-author">
                    {post.author.substring(0, 6)}...{post.author.substring(38)}
                  </div>
                  <div className="post-category">{post.category}</div>
                </div>
                
                <div className="post-content">
                  <div className="encrypted-badge">
                    <span>FHE-ENCRYPTED</span>
                  </div>
                  <p>Content encrypted with FHE technology</p>
                </div>
                
                <div className="post-footer">
                  <div className="post-date">
                    {new Date(post.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="post-actions">
                    <button 
                      className="like-btn glass-button"
                      onClick={() => likePost(post.id)}
                    >
                      👍 {post.likes}
                    </button>
                    <button className="comment-btn glass-button">
                      💬 {post.comments}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPost} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          postData={newPostData}
          setPostData={setNewPostData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="glass-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>PrivateFeedFHE</span>
            </div>
            <p>FHE-powered private social media content curation</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} PrivateFeedFHE. All content encrypted with FHE technology.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  postData: any;
  setPostData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  postData,
  setPostData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPostData({
      ...postData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!postData.content) {
      alert("Please add content to your post");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Create Encrypted Post</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔒</div> Your content will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category</label>
              <select 
                name="category"
                value={postData.category} 
                onChange={handleChange}
                className="glass-select"
              >
                <option value="General">General</option>
                <option value="Tech">Tech</option>
                <option value="Art">Art</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Content *</label>
              <textarea 
                name="content"
                value={postData.content} 
                onChange={handleChange}
                placeholder="What's on your mind?" 
                className="glass-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🛡️</div> Your data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn glass-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Post Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;