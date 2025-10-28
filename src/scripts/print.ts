// Listen for beforeprint event to open all details elements
window.addEventListener("beforeprint", function () {
	document.querySelectorAll("details").forEach(function (detail) {
		detail.setAttribute("open", true);
		detail.dataset.wasOpen = "true"; // Mark it as opened by the script
	});
});

// Optional: Listen for afterprint event to close all details elements
// that were opened by the script
window.addEventListener("afterprint", function () {
	document.querySelectorAll("details").forEach(function (detail) {
		if (detail.dataset.wasOpen) {
			detail.removeAttribute("open");
			delete detail.dataset.wasOpen; // Clean up
		}
	});
});
