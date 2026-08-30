const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function validateName(name, label = "name") {
	if (!name || typeof name !== "string") {
		throw new Error(`${label} is required`);
	}
	if (!SAFE_NAME.test(name)) {
		throw new Error(
			`${label} "${name}" contains invalid characters. Only A-Z, a-z, 0-9, '.', '_', and '-' are allowed.`,
		);
	}
	return name;
}

export function validatePort(port) {
	const num = Number.parseInt(port, 10);
	if (Number.isNaN(num) || num <= 0 || num > 65535) {
		throw new Error(`Invalid port "${port}". Must be between 1 and 65535.`);
	}
	return num;
}

export function validateDomain(domain) {
	if (!domain || typeof domain !== "string") {
		throw new Error("Domain is required");
	}
	const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
	if (!domainRegex.test(domain)) {
		throw new Error(`"${domain}" is not a valid domain name.`);
	}
	return domain;
}
