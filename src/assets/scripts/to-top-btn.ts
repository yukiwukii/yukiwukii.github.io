document.addEventListener("DOMContentLoaded", function () {
	const scrollBtn = document.getElementById("to-top-btn");
	const targetHeader = document.getElementById("main-header");

	function callback(entries) {
		entries.forEach((entry) => {
			scrollBtn.dataset.show = (!entry.isIntersecting).toString();
		});
	}

	scrollBtn.addEventListener("click", () => {
		document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
	});

	const observer = new IntersectionObserver(callback);
	observer.observe(targetHeader);
});
