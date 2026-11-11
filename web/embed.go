// Package web holds the default templates and static assets, embedded
// into the fpn binary.
package web

import "embed"

//go:embed templates static editor
var FS embed.FS
