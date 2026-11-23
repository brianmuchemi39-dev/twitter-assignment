/* =====================================================
   TWITTER CLONE - script.js
   Read it top to bottom. Each section has a heading.
   ===================================================== */


/* ---------- 1. SETTINGS ---------- */

// Get a free key at https://openrouter.ai/keys and paste it here.
// WARNING: keys in browser code are visible to anyone. Fine for class, never for real apps.
const OPENROUTER_API_KEY = "PASTE_YOUR_OPENROUTER_KEY_HERE";

// OPTIONAL avatars from RapidAPI. Leave empty to just use colored initials.
// Fill these in from your chosen API's "Code Snippets" tab. This code assumes
// the API returns an image directly; change loadAvatars() if yours returns JSON.
const RAPIDAPI_KEY = "";
const RAPIDAPI_HOST = "";
const AVATAR_URL = "";

const MAX_CHARS = 280;                                  // tweet limit
const API = "https://jsonplaceholder.typicode.com";     // fake data server


/* ---------- 2. APP STATE (the data our app remembers) ---------- */

let users = [];             // list of users from the server
let posts = [];             // list of posts from the server
let myPosts = [];           // tweets written by us in the compose box
let commentsByPost = {};    // { postId: [comment, comment, ...] }
let usersById = {};         // { userId: user } for quick lookup
let avatars = {};           // { userId: imageUrl } (stays empty if no avatar API)
let currentUser = null;     // the "logged-in" user (we use the first user)

let currentView = "home";   // "home" or "profile"
let profileUserId = null;   // which profile is open

// Sets store unique ids. "has(id)" tells us if an id is inside.
let likedPosts = new Set();
let retweetedPosts = new Set();
let openComments = new Set();   // posts whose comments are showing
let followedUsers = new Set();  // users we follow

// Chat history is sent to the AI every time so it remembers the conversation
let chatHistory = [];


/* ---------- 3. SHORTCUTS TO HTML ELEMENTS ---------- */

const feedEl = document.getElementById("feed");
const statusEl = document.getElementById("status");
const profileBox = document.getElementById("profileBox");
const composeBox = document.getElementById("composeBox");
const tweetInput = document.getElementById("tweetInput");
const tweetBtn = document.getElementById("tweetBtn");
const charCounter = document.getElementById("charCounter");
const chatPanel = document.getElementById("chatPanel");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");


/* ---------- 4. SMALL HELPER FUNCTIONS ---------- */

// Stops user-typed text from being treated as HTML (a basic security step)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// "Leanne Graham" -> "LG"
function getInitials(name) {
  return name.split(" ").map((word) => word[0]).slice(0, 2).join("");
}

// Draws an avatar: a photo if we have one, otherwise colored initials
function avatarHtml(user, size = "") {
  if (avatars[user.id]) {
    return `<img class="avatar ${size}" src="${avatars[user.id]}" alt="${escapeHtml(user.name)}">`;
  }
  // Each user gets a different color based on their id
  const color = `hsl(${user.id * 47 % 360}, 60%, 45%)`;
  return `<div class="avatar ${size}" style="background:${color}">${getInitials(user.name)}</div>`;
}

// Fake but steady numbers, since the server has no like counts
function baseLikes(post) {
  return (post.id * 3) % 20;
}
function baseRetweets(post) {
  return (post.id * 2) % 9;
}


/* ---------- 5. LOADING DATA ---------- */

async function loadData() {
  showLoading();
  try {
    // Promise.all starts all 3 requests together and waits for ALL of them
    const [usersRes, postsRes, commentsRes] = await Promise.all([
      fetch(`${API}/users`),
      fetch(`${API}/posts`),
      fetch(`${API}/comments`),   // fetched ONCE, then grouped below
    ]);

    // fetch does not throw on 404/500, so we check "ok" ourselves
    if (!usersRes.ok || !postsRes.ok || !commentsRes.ok) {
      throw new Error("The server replied with an error.");
    }

    users = await usersRes.json();
    posts = await postsRes.json();
    const comments = await commentsRes.json();

    // Look up users by id
    users.forEach((user) => {
      usersById[user.id] = user;
    });

    // Group comments by the post they belong to
    comments.forEach((comment) => {
      if (!commentsByPost[comment.postId]) {
        commentsByPost[comment.postId] = [];   // make the list the first time
      }
      commentsByPost[comment.postId].push(comment);
    });

    currentUser = users[0];
    statusEl.innerHTML = "";          // remove spinner
    renderComposeAvatar();
    render();                         // draw the page with initials first
    await loadAvatars();              // then try to load photos
    renderComposeAvatar();
    render();                         // draw again with photos (if any)
  } catch (error) {
    showError("Could not load data: " + error.message);
  }
}

// OPTIONAL: get one avatar picture per user. Any failure = keep initials.
async function loadAvatars() {
  if (!RAPIDAPI_KEY || !AVATAR_URL) return;   // not set up, skip
  for (const user of users) {
    try {
      const res = await fetch(`${AVATAR_URL}?name=${encodeURIComponent(user.username)}`, {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      });
      if (!res.ok) throw new Error("Avatar API failed or limit reached");
      const blob = await res.blob();
      avatars[user.id] = URL.createObjectURL(blob);
    } catch (error) {
      break;   // stop asking; the rest use initials (the fallback)
    }
  }
}

function showLoading() {
  statusEl.innerHTML = `<div class="spinner"></div>`;
}

function showError(message) {
  statusEl.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}


/* ---------- 6. DRAWING THE PAGE ---------- */

// Decides what to show based on the current view
function render() {
  if (currentView === "home") {
    document.getElementById("pageTitle").textContent = "Home";
    composeBox.classList.remove("hidden");
    profileBox.innerHTML = "";
    // Our new tweets go on top of the server posts
    renderFeed([...myPosts, ...posts]);
  } else {
    document.getElementById("pageTitle").textContent = "Profile";
    composeBox.classList.add("hidden");
    renderProfileHeader(usersById[profileUserId]);
    // Only this user's posts
    const theirPosts = [...myPosts, ...posts].filter((p) => p.userId === profileUserId);
    renderFeed(theirPosts);
  }
  renderWhoToFollow();
}

function renderComposeAvatar() {
  document.getElementById("composeAvatar").innerHTML = avatarHtml(currentUser);
}

// Draws a list of posts
function renderFeed(list) {
  feedEl.innerHTML = list.map(postHtml).join("");
}

// Builds the HTML for ONE post (a template string with ${} holes)
function postHtml(post) {
  const author = usersById[post.userId];
  const comments = commentsByPost[post.id] || [];   // [] if none
  const liked = likedPosts.has(post.id);
  const retweeted = retweetedPosts.has(post.id);

  // Only build the comments list if the toggle is open
  let commentsHtml = "";
  if (openComments.has(post.id)) {
    commentsHtml = `<div class="comments">` +
      (comments.length === 0 ? "<p>No comments yet.</p>" : comments.map((c) => `
        <div class="comment">
          <strong>${escapeHtml(c.name)}</strong>
          <span class="username">${escapeHtml(c.email)}</span>
          <div>${escapeHtml(c.body)}</div>
        </div>`).join("")) +
      `</div>`;
  }

  return `
    <article class="post">
      <button class="name-btn" data-action="profile" data-id="${author.id}" style="padding:0;border:none;background:none">
        ${avatarHtml(author)}
      </button>
      <div class="post-body">
        <button class="name-btn" data-action="profile" data-id="${author.id}">${escapeHtml(author.name)}</button>
        <span class="username">@${escapeHtml(author.username)}</span>
        ${post.title ? `<div class="post-title">${escapeHtml(post.title)}</div>` : ""}
        <div class="post-text">${escapeHtml(post.body)}</div>
        <div class="actions">
          <button class="action-btn" data-action="comments" data-id="${post.id}">Comments (${comments.length})</button>
          <button class="action-btn ${retweeted ? "active" : ""}" data-action="retweet" data-id="${post.id}">Retweet ${baseRetweets(post) + (retweeted ? 1 : 0)}</button>
          <button class="action-btn ${liked ? "active" : ""}" data-action="like" data-id="${post.id}">${liked ? "Liked" : "Like"} ${baseLikes(post) + (liked ? 1 : 0)}</button>
          <button class="action-btn" data-action="summarize" data-id="${post.id}">Summarize with AI</button>
        </div>
        ${commentsHtml}
      </div>
    </article>`;
}

// The top part of a profile page
function renderProfileHeader(user) {
  const following = followedUsers.has(user.id);
  const isMe = user.id === currentUser.id;
  const postCount = [...myPosts, ...posts].filter((p) => p.userId === user.id).length;
  // The server has no follower numbers, so we make some up from the id
  const followers = 800 + user.id * 103;
  const followingCount = 100 + user.id * 11;

  profileBox.innerHTML = `
    <div class="cover"></div>
    <div class="profile-info">
      <div class="profile-top">
        ${avatarHtml(user, "big")}
        ${isMe ? "" : `<button class="follow-btn ${following ? "following" : ""}" data-action="follow" data-id="${user.id}">${following ? "Following" : "Follow"}</button>`}
      </div>
      <h2 style="margin:8px 0 0">${escapeHtml(user.name)}</h2>
      <div class="username">@${escapeHtml(user.username)}</div>
      <p>${escapeHtml(user.company.catchPhrase)}</p>
      <p class="username">
        Works at ${escapeHtml(user.company.name)} | ${escapeHtml(user.address.city)}<br>
        ${escapeHtml(user.website)} | ${escapeHtml(user.email)}
      </p>
      <div class="stats">
        <span><strong>${followingCount}</strong> Following</span>
        <span><strong>${followers + (following ? 1 : 0)}</strong> Followers</span>
        <span><strong>${postCount}</strong> Posts</span>
      </div>
    </div>`;
}

// The "Who to follow" panel: first 3 users that are not us
function renderWhoToFollow() {
  const suggestions = users.filter((u) => u.id !== currentUser.id).slice(0, 3);
  document.getElementById("whoToFollow").innerHTML = suggestions.map((u) => `
    <div class="follow-row">
      ${avatarHtml(u)}
      <div class="grow">
        <button class="name-btn" data-action="profile" data-id="${u.id}">${escapeHtml(u.name)}</button>
        <div class="username">@${escapeHtml(u.username)}</div>
      </div>
      <button class="follow-btn ${followedUsers.has(u.id) ? "following" : ""}" data-action="follow" data-id="${u.id}">
        ${followedUsers.has(u.id) ? "Following" : "Follow"}
      </button>
    </div>`).join("");
}


/* ---------- 7. CLICK HANDLING ---------- */

// ONE listener for the whole page ("event delegation"). Every clickable thing has
// data-action="..." so we look at what was clicked and decide what to do.
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;                         // clicked something else

  const action = button.dataset.action;
  const id = Number(button.dataset.id);        // dataset values are text, so convert

  if (action === "nav") {
    const view = button.dataset.view;
    if (view === "home") {
      currentView = "home";
      render();
    } else if (view === "profile") {
      currentView = "profile";
      profileUserId = currentUser.id;          // Profile tab = my profile
      render();
    } else if (view === "ai") {
      chatPanel.classList.remove("hidden");
    }
  } else if (action === "profile") {
    currentView = "profile";
    profileUserId = id;
    render();
    window.scrollTo(0, 0);
  } else if (action === "like") {
    toggleInSet(likedPosts, id);
  } else if (action === "retweet") {
    toggleInSet(retweetedPosts, id);
  } else if (action === "comments") {
    toggleInSet(openComments, id);
  } else if (action === "follow") {
    toggleInSet(followedUsers, id);
  } else if (action === "summarize") {
    summarizePost(id);
  } else if (action === "toggleChat") {
    chatPanel.classList.toggle("hidden");
  }
});

// If the id is in the set remove it, otherwise add it. Then redraw.
function toggleInSet(set, id) {
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  render();
}


/* ---------- 8. COMPOSE BOX ---------- */

// Runs every time the user types
tweetInput.addEventListener("input", () => {
  const remaining = MAX_CHARS - tweetInput.value.length;
  charCounter.textContent = remaining;
  charCounter.classList.toggle("over-limit", remaining < 0);
  // Disable the button if empty or too long
  tweetBtn.disabled = tweetInput.value.trim() === "" || remaining < 0;
});

tweetBtn.addEventListener("click", () => {
  const newPost = {
    id: Date.now(),             // unique id from the clock
    userId: currentUser.id,
    title: "",
    body: tweetInput.value.trim(),
  };
  myPosts.unshift(newPost);     // unshift = add to the START of the array
  tweetInput.value = "";
  charCounter.textContent = MAX_CHARS;
  tweetBtn.disabled = true;
  render();
});


/* ---------- 9. AI CHAT (OpenRouter) ---------- */

// Adds a message bubble to the chat window
function addChatMessage(type, text) {
  const div = document.createElement("div");
  div.className = "msg " + type;      // "user", "assistant" or "error-msg"
  div.textContent = text;             // textContent is safe from HTML injection
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;   // scroll to bottom
  return div;
}

// Sends the whole conversation to OpenRouter and shows the reply
async function askAI(userText) {
  chatPanel.classList.remove("hidden");
  addChatMessage("user", userText);
  chatHistory.push({ role: "user", content: userText });

  const thinking = addChatMessage("assistant", "Thinking...");   // indicator
  chatSend.disabled = true;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: chatHistory,         // the full history = the AI remembers
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Request failed (" + response.status + ")");
    }

    const reply = data.choices[0].message.content;
    chatHistory.push({ role: "assistant", content: reply });   // remember the reply
    thinking.textContent = reply;
  } catch (error) {
    thinking.className = "msg error-msg";
    thinking.textContent = "Error: " + error.message;
    chatHistory.pop();   // drop the failed question so history stays clean
  }
  chatSend.disabled = false;
}

// Builds a prompt from a post and its comments
function summarizePost(postId) {
  const post = [...myPosts, ...posts].find((p) => p.id === postId);
  const author = usersById[post.userId];
  const comments = commentsByPost[postId] || [];
  const commentText = comments.map((c) => "- " + c.name + ": " + c.body).join("\n");

  askAI(
    "Summarize this post by " + author.name + " in 2-3 sentences.\n\n" +
    "Post: " + post.title + " " + post.body + "\n\n" +
    "Comments:\n" + (commentText || "(none)")
  );
}

// Send button and Enter key
function sendChat() {
  const text = chatInput.value.trim();
  if (text === "") return;
  chatInput.value = "";
  askAI(text);
}
chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendChat();
});


/* ---------- 10. START THE APP ---------- */
loadData();
