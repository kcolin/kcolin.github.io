// Global variables
let currentPage = 1;
let pageSize = 10;
let totalPages = 1;
let apiBaseUrl = '';
let accessToken = '';
let deletePageId = null;

// DOM elements
const apiUrlInput = document.getElementById('api-url');
const seoPageTable = document.getElementById('seo-pages-table');
const seoPageBody = document.getElementById('seo-pages-body');
const addSeoPageBtn = document.getElementById('add-seo-page');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const loadingIndicator = document.getElementById('loading-indicator');
const errorMessage = document.getElementById('error-message');

// Modal elements
const seoPageModal = document.getElementById('seo-page-modal');
const modalTitle = document.getElementById('modal-title');
const closeModalBtn = document.querySelector('.close');
const cancelBtn = document.getElementById('cancel-btn');
const saveBtn = document.getElementById('save-btn');
const seoPageForm = document.getElementById('seo-page-form');
const pageIdInput = document.getElementById('page-id');
const urlInput = document.getElementById('url');
const titleInput = document.getElementById('title');
const metaDescriptionInput = document.getElementById('meta-description');
const h1Input = document.getElementById('h1');
const descriptionInput = document.getElementById('description');

// Confirmation modal elements
const confirmationModal = document.getElementById('confirmation-modal');
const cancelDeleteBtn = document.getElementById('cancel-delete');
const confirmDeleteBtn = document.getElementById('confirm-delete');

// Event listeners
document.addEventListener('DOMContentLoaded', init);
apiUrlInput.addEventListener('change', updateApiUrl);
addSeoPageBtn.addEventListener('click', showAddModal);
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
seoPageForm.addEventListener('submit', handleFormSubmit);
prevPageBtn.addEventListener('click', () => navigateToPage(currentPage - 1));
nextPageBtn.addEventListener('click', () => navigateToPage(currentPage + 1));
cancelDeleteBtn.addEventListener('click', closeConfirmationModal);
confirmDeleteBtn.addEventListener('click', confirmDelete);

// Initialize the application
function init() {
    apiBaseUrl = apiUrlInput.value;
    refreshToken()
        .then(() => {
            loadSeoPages(currentPage);
        })
        .catch(error => {
            showError(`Failed to initialize: ${error.message}`);
        });
}

// Update API URL when changed
function updateApiUrl() {
    apiBaseUrl = apiUrlInput.value;
    refreshToken()
        .then(() => {
            loadSeoPages(currentPage);
        })
        .catch(error => {
            showError(`Failed to update API URL: ${error.message}`);
        });
}

// Refresh the access token
async function refreshToken() {
    try {
        const response = await fetch(`${apiBaseUrl.replace('/catalog', '')}/admin/auth/refresh-token`, {
            method: 'GET',
            credentials: 'include' // Include cookies for auth
        });

        if (!response.ok) {
            throw new Error(`Failed to refresh token: ${response.status}`);
        }

        const data = await response.json();
        accessToken = data.access_token;
        return accessToken;
    } catch (error) {
        console.error('Error refreshing token:', error);
        showError('Failed to refresh authentication token. Please check if you\'re logged in.');
        throw error;
    }
}

// API request helper with automatic token refresh
async function apiRequest(url, options = {}) {
    // Set default headers
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${accessToken}`;
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';

    try {
        const response = await fetch(url, options);

        // If unauthorized, try to refresh token and retry
        if (response.status === 401) {
            await refreshToken();
            options.headers['Authorization'] = `Bearer ${accessToken}`;
            return fetch(url, options);
        }

        return response;
    } catch (error) {
        console.error('API request error:', error);
        throw error;
    }
}

// Load SEO pages with pagination
async function loadSeoPages(page) {
    showLoading(true);
    hideError();

    try {
        const response = await apiRequest(`${apiBaseUrl}/category-seo?page=${page}&size=${pageSize}`);

        if (!response.ok) {
            throw new Error(`Failed to load SEO pages: ${response.status}`);
        }

        const data = await response.json();

        // Update pagination
        currentPage = page;
        totalPages = Math.ceil(data.paginate.total / pageSize);

        updatePagination();
        renderSeoPages(data.items);

        showLoading(false);
    } catch (error) {
        console.error('Error loading SEO pages:', error);
        showError(`Failed to load SEO pages: ${error.message}`);
        showLoading(false);
    }
}

// Render SEO pages to the table
function renderSeoPages(pages) {
    seoPageBody.innerHTML = '';

    if (pages.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="5" style="text-align: center;">No SEO pages found</td>';
        seoPageBody.appendChild(row);
        return;
    }

    pages.forEach(page => {
        const row = document.createElement('tr');

        // Format date for better readability
        const updatedDate = new Date(page.updated_at).toLocaleString();

        row.innerHTML = `
            <td>${page.id}</td>
            <td>${page.url}</td>
            <td>${page.title || '-'}</td>
            <td>${updatedDate}</td>
            <td>
                <button class="action-btn primary-btn edit-btn" data-id="${page.id}">Edit</button>
                <button class="action-btn danger-btn delete-btn" data-id="${page.id}">Delete</button>
            </td>
        `;

        seoPageBody.appendChild(row);
    });

    // Add event listeners to the new buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            openEditModal(id);
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            openDeleteConfirmation(id);
        });
    });
}

// Update pagination controls
function updatePagination() {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
}

// Navigate to a specific page
function navigateToPage(page) {
    if (page < 1 || page > totalPages) return;
    loadSeoPages(page);
}

// Show add modal
function showAddModal() {
    modalTitle.textContent = 'Add New SEO Page';
    pageIdInput.value = '';
    seoPageForm.reset();
    seoPageModal.style.display = 'block';
}

// Open edit modal with data
async function openEditModal(id) {
    showLoading(true);

    try {
        const response = await apiRequest(`${apiBaseUrl}/category-seo/${id}`);

        if (!response.ok) {
            throw new Error(`Failed to load SEO page details: ${response.status}`);
        }

        const page = await response.json();

        modalTitle.textContent = 'Edit SEO Page';
        pageIdInput.value = page.id;
        urlInput.value = page.url || '';
        titleInput.value = page.title || '';
        metaDescriptionInput.value = page.meta_description || '';
        h1Input.value = page.h1 || '';
        descriptionInput.value = page.description || '';

        seoPageModal.style.display = 'block';
        showLoading(false);
    } catch (error) {
        console.error('Error loading SEO page details:', error);
        showError(`Failed to load SEO page details: ${error.message}`);
        showLoading(false);
    }
}

// Close the modal
function closeModal() {
    seoPageModal.style.display = 'none';
    seoPageForm.reset();
}

// Handle form submission (create or update)
async function handleFormSubmit(event) {
    event.preventDefault();

    const isEditing = pageIdInput.value !== '';

    const seoPageData = {
        url: urlInput.value,
        title: titleInput.value || null,
        meta_description: metaDescriptionInput.value || null,
        h1: h1Input.value || null,
        description: descriptionInput.value || null
    };

    showLoading(true);

    try {
        let response;

        if (isEditing) {
            // Update existing page
            response = await apiRequest(
                `${apiBaseUrl}/category-seo/${pageIdInput.value}`,
                {
                    method: 'PUT',
                    body: JSON.stringify(seoPageData)
                }
            );
        } else {
            // Create new page
            response = await apiRequest(
                `${apiBaseUrl}/category-seo`,
                {
                    method: 'POST',
                    body: JSON.stringify(seoPageData)
                }
            );
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Operation failed with status: ${response.status}`);
        }

        closeModal();
        loadSeoPages(currentPage);
    } catch (error) {
        console.error('Error saving SEO page:', error);
        showError(`Failed to save SEO page: ${error.message}`);
        showLoading(false);
    }
}

// Open delete confirmation modal
function openDeleteConfirmation(id) {
    deletePageId = id;
    confirmationModal.style.display = 'block';
}

// Close confirmation modal
function closeConfirmationModal() {
    confirmationModal.style.display = 'none';
    deletePageId = null;
}

// Confirm delete operation
async function confirmDelete() {
    if (!deletePageId) return;

    showLoading(true);

    try {
        const response = await apiRequest(
            `${apiBaseUrl}/category-seo/${deletePageId}`,
            { method: 'DELETE' }
        );

        if (!response.ok) {
            throw new Error(`Failed to delete SEO page: ${response.status}`);
        }

        closeConfirmationModal();
        loadSeoPages(currentPage);
    } catch (error) {
        console.error('Error deleting SEO page:', error);
        showError(`Failed to delete SEO page: ${error.message}`);
        showLoading(false);
    }
}

// Show/hide loading indicator
function showLoading(show) {
    loadingIndicator.style.display = show ? 'block' : 'none';

    // Disable interactive elements during loading
    const interactiveElements = document.querySelectorAll('button, input, textarea');
    interactiveElements.forEach(el => {
        el.disabled = show;
    });
}

// Show error message
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

// Hide error message
function hideError() {
    errorMessage.style.display = 'none';
}