package guard

import "strings"

func denyPath(rel string) error {
	if rel == "" {
		return nil
	}
	parts := strings.Split(rel, "/")
	for i, part := range parts {
		if skippedDir(part) {
			return code("denied", "The path is inside a directory the bridge does not read.")
		}
		if sensitiveDir(part) {
			return code("denied", "The path is refused by the default denylist.")
		}
		if i == len(parts)-1 && secretFile(part) {
			return code("denied", "The path is refused by the default denylist.")
		}
	}
	return nil
}

func skippedDir(name string) bool {
	switch strings.ToLower(name) {
	case ".git", ".svn", ".hg",
		"node_modules", "vendor",
		"dist", "build", "out", "target",
		".next", ".nuxt", ".output",
		".venv", "venv", "__pycache__",
		".turbo", "coverage", ".cache":
		return true
	default:
		return false
	}
}

func sensitiveDir(name string) bool {
	switch strings.ToLower(name) {
	case ".ssh", ".aws", ".gnupg", ".kube", ".docker":
		return true
	default:
		return false
	}
}

func secretFile(name string) bool {
	lower := strings.ToLower(name)
	switch lower {
	case ".env", ".npmrc", ".pypirc", ".netrc", "_netrc", ".pgpass", ".my.cnf",
		".secrets", "credentials.json", "credentials.yml", "credentials.yaml",
		"secrets.json", "secrets.yml", "secrets.yaml",
		"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
		"service-account.json", "wp-config.php":
		return true
	}
	if strings.HasPrefix(lower, ".env.") {
		return true
	}
	if strings.HasSuffix(lower, "-service-account.json") {
		return true
	}
	switch ext(lower) {
	case ".pem", ".key", ".p12", ".pfx", ".kdbx", ".keystore", ".jks", ".ppk", ".p8", ".secret":
		return true
	default:
		return false
	}
}

func ext(name string) string {
	i := strings.LastIndex(name, ".")
	if i <= 0 {
		return ""
	}
	return name[i:]
}
