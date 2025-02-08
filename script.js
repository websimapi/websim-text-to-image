// Initialize WebSocket connection
const room = new WebsimSocket();

// Track hover timeouts to prevent multiple rapid views
const hoverTimeouts = new Map();

// Global variable to track current image ID for comments
let currentImageId = null;

// New variables for filtering
let currentFilter = 'new';
let cachedImages = [];
let cachedViews = [];

// Create a view record for an image
async function createView(imageId) {
  await room.collection('views').create({
    image_id: imageId
  });
}

// Calculate views for an image
function calculateViews(imageId, views) {
  return views.filter(view => view.image_id === imageId).length;
}

// Format date for display
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString();
}

// Show viewers modal
function showViewers(imageId) {
  const modal = document.getElementById('viewersModal');
  const viewersList = document.getElementById('viewersList');
  
  // Get views directly (getList is synchronous)
  const views = room.collection('views').getList();
  
  // Filter views for this image and sort by creation date
  const imageViews = views
    .filter(view => view.image_id === imageId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  // Clear previous content
  viewersList.innerHTML = '';
  
  // Add viewers to list
  imageViews.forEach(view => {
    const viewerItem = document.createElement('div');
    viewerItem.className = 'viewer-item';
    viewerItem.innerHTML = `
      <img class="user-avatar" src="https://images.websim.ai/avatar/${view.username}" alt="${view.username}">
      <div class="viewer-info">
        <span class="viewer-name">${view.username}</span>
        <span class="view-time">${formatDate(view.created_at)}</span>
      </div>
    `;
    viewersList.appendChild(viewerItem);
  });
  
  modal.classList.add('show');
}

// Show comments modal
function showComments(imageId) {
  currentImageId = imageId;
  const modal = document.getElementById('viewersModal');
  updateCommentsUI(imageId);
  
  // Switch to comments tab
  document.querySelectorAll('.modal-tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.modal-content-section').forEach(s => s.classList.remove('active'));
  document.querySelector('[data-section="commentsSection"]').classList.add('active');
  document.getElementById('commentsSection').classList.add('active');
  
  modal.classList.add('show');
}

// Update comments UI
function updateCommentsUI(imageId) {
  const commentsList = document.getElementById('commentsList');
  
  // Get comments
  const comments = room.collection('comments').getList();
  const imageComments = comments
    .filter(comment => comment.image_id === imageId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  // Clear and populate comments list
  commentsList.innerHTML = '';
  imageComments.forEach(comment => {
    const commentItem = document.createElement('div');
    commentItem.className = 'comment-item';
    commentItem.innerHTML = `
      <img class="user-avatar" src="https://images.websim.ai/avatar/${comment.username}" alt="${comment.username}">
      <div class="comment-content">
        <div class="comment-header">
          <span class="comment-author">${comment.username}</span>
          <span class="comment-time">${formatDate(comment.created_at)}</span>
        </div>
        <div class="comment-text">${comment.comment_text}</div>
      </div>
    `;
    commentsList.appendChild(commentItem);
  });
}

// Handle image creation
document.getElementById('createBtn').addEventListener('click', async () => {
  const inputText = document.getElementById('imageUrl').value.trim();
  
  if (inputText) {
    const img = document.createElement('img');
    img.id = 'img_' + Date.now();
    img.src = inputText;
    img.alt = inputText;
    
    img.onload = async function() {
      if (img.src !== inputText) {
        try {
          const response = await fetch(img.src);
          const blob = await response.blob();
          const uploadedUrl = await websim.upload(blob);
          
          await room.collection('images').create({
            text: uploadedUrl,
            prompt: inputText
          });
          
          img.remove();
        } catch (error) {
          console.error('Error processing image:', error);
        }
      }
    };
    
    document.getElementById('imageUrl').value = '';
    document.getElementById('imageContainer').appendChild(img);
  }
});

// Function to update view counters
function updateViewCounters(views) {
  const viewCounts = new Map();
  
  views.forEach(view => {
    const count = viewCounts.get(view.image_id) || 0;
    viewCounts.set(view.image_id, count + 1);
  });
  
  viewCounts.forEach((count, imageId) => {
    const counter = document.getElementById(`views_${imageId}`);
    if (counter) {
      counter.textContent = count;
    }
  });
}

// Function to download image
async function downloadImage(imageUrl) {
  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Create a canvas to convert the image to PNG
    const img = new Image();
    img.crossOrigin = "anonymous";  // Enable CORS
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      // Convert to PNG and download
      canvas.toBlob((pngBlob) => {
        const url = window.URL.createObjectURL(pngBlob);
        const a = document.createElement('a');
        a.href = url;
        // Use timestamp for unique filename
        a.download = `image-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 'image/png');
    };
    
    // Set image source from blob
    img.src = URL.createObjectURL(blob);
    
  } catch (error) {
    console.error('Error downloading image:', error);
  }
}

// Subscribe to image changes in the database
room.collection('images').subscribe(images => {
  cachedImages = images;
  updateGallery();
});

// Subscribe to views and update counters
room.collection('views').subscribe(views => {
  cachedViews = views;
  updateViewCounters(views);
});

// New filtering functions
function getFilteredImages() {
  const userUsername = room.party.client.username;
  
  switch(currentFilter) {
    case 'new':
      return [...cachedImages].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
    case 'hot':
      return [...cachedImages].sort((a, b) => {
        const viewsA = calculateViews(a.id, cachedViews);
        const viewsB = calculateViews(b.id, cachedViews);
        return viewsB - viewsA;
      });
      
    case 'recent':
      const recentlyViewed = new Map();
      cachedViews.forEach(view => {
        recentlyViewed.set(view.image_id, 
          Math.max(new Date(view.created_at).getTime(), 
            recentlyViewed.get(view.image_id) || 0)
        );
      });
      
      return [...cachedImages].filter(img => recentlyViewed.has(img.id))
        .sort((a, b) => recentlyViewed.get(b.id) - recentlyViewed.get(a.id));
      
    case 'yours':
      return cachedImages.filter(img => img.username === userUsername);
      
    default:
      return cachedImages;
  }
}

// Update gallery function
function updateGallery() {
  const container = document.getElementById('imageContainer');
  container.innerHTML = '';
  
  const filteredImages = getFilteredImages();
  
  filteredImages.forEach(image => {
    const div = document.createElement('div');
    div.id = 'img_' + image.id;
    div.className = 'image-box';
    
    const imageContent = document.createElement('div');
    imageContent.className = 'image-content';
    imageContent.style.backgroundImage = `url(${image.text})`;
    imageContent.setAttribute('title', image.prompt || image.text);
    
    // Add hover event listener for views
    imageContent.addEventListener('mouseenter', () => {
      if (hoverTimeouts.has(image.id)) {
        clearTimeout(hoverTimeouts.get(image.id));
      }
      
      const timeout = setTimeout(() => {
        createView(image.id);
      }, 500);
      
      hoverTimeouts.set(image.id, timeout);
    });
    
    imageContent.addEventListener('mouseleave', () => {
      if (hoverTimeouts.has(image.id)) {
        clearTimeout(hoverTimeouts.get(image.id));
        hoverTimeouts.delete(image.id);
      }
    });
    
    imageContent.addEventListener('click', () => {
      showFullscreenImage(image.text, image.prompt);
    });

    const userInfo = document.createElement('div');
    userInfo.className = 'user-info';

    // Add copy button
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-prompt-btn';
    copyButton.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
    `;
    copyButton.title = "Copy prompt to input";
    copyButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent event bubbling
      const input = document.getElementById('imageUrl');
      input.value = image.prompt || image.text;
      input.focus();
      input.scrollIntoView({ behavior: 'smooth' });
    });

    userInfo.appendChild(copyButton);
    userInfo.appendChild(document.createTextNode(image.username));
    
    const avatar = document.createElement('img');
    avatar.className = 'user-avatar';
    avatar.src = `https://images.websim.ai/avatar/${image.username}`;
    avatar.alt = image.username;
    
    const viewsCounter = document.createElement('div');
    viewsCounter.className = 'views-counter';
    viewsCounter.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
      </svg>
      <span id="views_${image.id}">${calculateViews(image.id, cachedViews)}</span>
    `;
    
    // Add click handler to show viewers
    viewsCounter.addEventListener('click', () => {
      showViewers(image.id);
    });
    
    const commentCounter = document.createElement('div');
    commentCounter.className = 'comment-counter';
    commentCounter.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/>
      </svg>
      <span id="comments_${image.id}">0</span>
    `;
    
    // Add click handler to show comments
    commentCounter.addEventListener('click', () => {
      showComments(image.id);
    });
    
    // Add download counter/button
    const downloadCounter = document.createElement('div');
    downloadCounter.className = 'download-counter';
    downloadCounter.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
    `;
    
    // Add click handler to download image
    downloadCounter.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent fullscreen view
      downloadImage(image.text);
    });

    userInfo.appendChild(avatar);
    div.appendChild(imageContent);
    div.appendChild(userInfo);
    div.appendChild(viewsCounter);
    div.appendChild(commentCounter);
    div.appendChild(downloadCounter); // Add the download button
    container.appendChild(div);
  });
  
  // Update view counters after adding all images
  updateViewCounters(cachedViews);
}

// Add filter button handling
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('viewersModal');
  const closeBtn = document.getElementById('closeModal');
  const tabs = document.querySelectorAll('.modal-tab');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const section = tab.getAttribute('data-section');
      
      // Update active states
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      document.querySelectorAll('.modal-content-section').forEach(s => s.classList.remove('active'));
      document.getElementById(section).classList.add('active');
    });
  });
  
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('show');
    currentImageId = null;
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
      currentImageId = null;
    }
  });
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      document.querySelectorAll('.filter-btn').forEach(b => 
        b.classList.remove('active')
      );
      btn.classList.add('active');
      
      // Update filter and refresh gallery
      currentFilter = btn.getAttribute('data-filter');
      updateGallery();
    });
  });
});

function showFullscreenImage(imageUrl, prompt) {
  // Create fullscreen viewer if it doesn't exist
  let viewer = document.getElementById('fullscreenViewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'fullscreenViewer';
    viewer.className = 'fullscreen-viewer';
    document.body.appendChild(viewer);
    
    // Close on click outside
    viewer.addEventListener('click', (e) => {
      if (e.target === viewer) {
        viewer.classList.remove('show');
      }
    });
  }
  
  // Update viewer content
  viewer.innerHTML = `
    <img src="${imageUrl}" class="fullscreen-image" alt="${prompt || 'Image'}">
    ${prompt ? `<div class="fullscreen-prompt">${prompt}</div>` : ''}
  `;
  
  // Show viewer
  viewer.classList.add('show');
}

// Handle comment submission
async function submitComment() {
  if (!currentImageId) return;
  
  const commentInput = document.getElementById('commentInput');
  const commentText = commentInput.value.trim();
  
  if (commentText) {
    await room.collection('comments').create({
      image_id: currentImageId,
      comment_text: commentText
    });
    
    commentInput.value = '';
    // Immediately update the comments UI after submitting
    updateCommentsUI(currentImageId);
  }
}

// Subscribe to comments and update counters
room.collection('comments').subscribe(comments => {
  const commentCounts = new Map();
  
  comments.forEach(comment => {
    const count = commentCounts.get(comment.image_id) || 0;
    commentCounts.set(comment.image_id, count + 1);
  });
  
  commentCounts.forEach((count, imageId) => {
    const counter = document.getElementById(`comments_${imageId}`);
    if (counter) {
      counter.textContent = count;
    }
  });
  
  // If comments modal is open, update the comments UI
  if (currentImageId) {
    updateCommentsUI(currentImageId);
  }
});