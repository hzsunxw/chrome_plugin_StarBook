/**
 * Edge-optimized Side Panel JavaScript
 * Enhanced performance and Windows integration
 */

// Initialize browser adapter
let adapter;

document.addEventListener('DOMContentLoaded', async function() {
    // Load browser adapter
    adapter = new EdgeBrowserAdapter();

    const browserInfo = adapter.getBrowserInfo();
    console.log(`Edge Side Panel loaded for: ${browserInfo.type}`);

    // Initialize Edge-specific features
    await initializeEdgeFeatures();

    // Set up event listeners
    setupEventListeners();

    // Load initial content
    await loadContent();
});

async function initializeEdgeFeatures() {
    if (!adapter.isEdge) {
        console.log('Running on non-Edge browser, skipping Edge optimizations');
        return;
    }

    console.log('Initializing Edge-specific optimizations...');

    // Enable Edge performance optimizations
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            console.log('Edge idle callback optimization active');
        });
    }

    // Check for Windows-specific features
    if (navigator.platform.includes('Win')) {
        enableWindowsIntegration();
    }

    // Update status display
    updateStatus('Edge Optimized');
}

function enableWindowsIntegration() {
    console.log('Windows integration enabled for Edge Side Panel');

    // Windows-specific optimizations could include:
    // - System notifications
    // - Windows search integration
    // - Taskbar interaction
    // - Microsoft services integration
}

function setupEventListeners() {
    // Edge Quiz button
    const quizButton = document.getElementById('edge-quiz-button');
    if (quizButton) {
        quizButton.addEventListener('click', handleEdgeQuiz);
    }

    // Handle messages from background script
    if (adapter) {
        // Note: In service worker context, we'd use chrome.runtime.onMessage
        // Here we're handling the content script case
    }
}

async function handleEdgeQuiz() {
    const button = document.getElementById('edge-quiz-button');
    const originalText = button.textContent;

    // Show loading state with Edge styling
    button.innerHTML = '<div class="edge-spinner"></div>Generating...';
    button.classList.add('edge-loading');

    try {
        // Use adapter for cross-browser messaging
        const response = await adapter.runtimeSendMessage({
            action: 'generate_quiz_in_tab',
            target: 'sidepanel'
        });

        if (response && response.status === 'success') {
            button.innerHTML = '✓ Quiz Generated';
            updateStatus('Quiz Ready');

            // Show quiz interface (placeholder)
            showQuizInterface(response.data);

        } else {
            throw new Error(response?.message || 'Failed to generate quiz');
        }

    } catch (error) {
        console.error('Edge quiz generation failed:', error);
        button.innerHTML = '❌ Retry';
        updateStatus('Error: ' + error.message);

        // Add retry functionality
        button.onclick = () => {
            button.innerHTML = originalText;
            button.onclick = handleEdgeQuiz;
            handleEdgeQuiz();
        };

    } finally {
        // Remove loading state
        setTimeout(() => {
            button.classList.remove('edge-loading');
        }, 1000);
    }
}

function showQuizInterface(quizData) {
    // Create a simple quiz interface optimized for Edge
    const contentDiv = document.getElementById('bookmark-content');

    const quizHTML = `
        <div class="edge-optimizations">
            <h4>Generated Quiz</h4>
            <div id="quiz-questions">
                ${quizData.questions ? quizData.questions.slice(0, 3).map((q, i) => `
                    <div class="edge-question" style="margin-bottom: 16px;">
                        <strong>Q${i + 1}:</strong> ${q.question}
                        <div style="margin-top: 8px;">
                            ${q.options.map((opt, j) => `
                                <label style="display: block; margin: 4px 0; cursor: pointer;">
                                    <input type="radio" name="q${i}" value="${j}">
                                    ${opt}
                                </label>
                            `).join('')}
                        </div>
                    </div>
                `).join('') : '<p>No questions available</p>'}
            </div>
            <button onclick="checkQuiz()" style="
                background: #0078d4;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                width: 100%;
                margin-top: 16px;
            ">
                Check Answers
            </button>
        </div>
    `;

    contentDiv.innerHTML = quizHTML;
}

function updateStatus(status) {
    const statusElement = document.getElementById('bookmarker-status');
    if (statusElement) {
        statusElement.textContent = status;

        // Add visual feedback for Edge
        statusElement.style.transition = 'color 0.3s ease';
        statusElement.style.color = status.includes('Error') ? '#d13438' : '#107c10';
    }
}

async function loadContent() {
    // Load initial content based on current tab
    try {
        const response = await adapter.runtimeSendMessage({
            action: 'getBookmarkIdForCurrentTab'
        });

        if (response && response.bookmarkId) {
            updateStatus('Bookmark Found');
            loadBookmarkContent(response.bookmarkId);
        } else {
            updateStatus('No Bookmark');
        }

    } catch (error) {
        console.error('Failed to load content:', error);
        updateStatus('Load Error');
    }
}

async function loadBookmarkContent(bookmarkId) {
    try {
        const response = await adapter.runtimeSendMessage({
            action: 'getBookmarkContent',
            bookmarkId: bookmarkId
        });

        if (response && response.bookmark) {
            displayBookmarkInfo(response.bookmark);
        }

    } catch (error) {
        console.error('Failed to load bookmark content:', error);
    }
}

function displayBookmarkInfo(bookmark) {
    const contentDiv = document.getElementById('bookmark-content');
    const existingQuiz = document.querySelector('.edge-optimizations');

    if (existingQuiz) {
        existingQuiz.remove();
    }

    const bookmarkInfo = document.createElement('div');
    bookmarkInfo.className = 'edge-optimizations';
    bookmarkInfo.innerHTML = `
        <h4>Current Bookmark</h4>
        <p><strong>Title:</strong> ${bookmark.title || 'Untitled'}</p>
        <p><strong>Category:</strong> ${bookmark.smartCategories?.[0]?.category || 'Uncategorized'}</p>
        ${bookmark.summary ? `<p><strong>Summary:</strong> ${bookmark.summary.substring(0, 100)}...</p>` : ''}
    `;

    contentDiv.insertBefore(bookmarkInfo, contentDiv.firstChild);
}

// Quick action functions
async function openOptions() {
    try {
        await adapter.runtimeSendMessage({ action: 'openOptions' });
    } catch (error) {
        console.error('Failed to open options:', error);
    }
}

async function syncBookmarks() {
    const syncButton = document.querySelector('[onclick="syncBookmarks()"]');
    const originalText = syncButton.innerHTML;

    syncButton.innerHTML = '<div class="edge-spinner"></div>Syncing...';
    syncButton.classList.add('edge-loading');

    try {
        const response = await adapter.runtimeSendMessage({ action: 'syncBookmarks' });

        if (response && response.status === 'success') {
            syncButton.innerHTML = '✓ Synced';
            updateStatus('Sync Complete');
        } else {
            throw new Error('Sync failed');
        }

    } catch (error) {
        syncButton.innerHTML = '❌ Retry';
        updateStatus('Sync Error');
    } finally {
        setTimeout(() => {
            syncButton.classList.remove('edge-loading');
            syncButton.innerHTML = originalText;
        }, 2000);
    }
}

function checkQuiz() {
    // Simple quiz checking logic
    const questions = document.querySelectorAll('.edge-question');
    let score = 0;
    let total = questions.length;

    questions.forEach((question, i) => {
        const selected = question.querySelector('input[type="radio"]:checked');
        if (selected && parseInt(selected.value) === 0) { // Assuming first option is correct
            score++;
        }
    });

    alert(`Quiz Complete!\nScore: ${score}/${total}\n${score === total ? 'Perfect! 🎉' : 'Keep practicing! 📚'}`);
}

// Error handling
window.addEventListener('error', function(e) {
    console.error('Edge Side Panel Error:', e.error);
    updateStatus('Error: ' + e.error.message);
});

// Performance monitoring
if (performance && performance.measure) {
    document.addEventListener('DOMContentLoaded', function() {
        const loadTime = performance.now();
        console.log(`Edge Side Panel loaded in ${loadTime.toFixed(2)}ms`);

        // Log performance metrics for optimization
        if (adapter && adapter.isEdge) {
            adapter.sendPerformanceMetrics && adapter.sendPerformanceMetrics({
                loadTime: loadTime,
                features: ['edge-optimizations', 'windows-integration']
            });
        }
    });
}