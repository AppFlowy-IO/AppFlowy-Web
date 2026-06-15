#!/bin/bash

################################################################################
# AppFlowy E2E Test Environment Setup Script
#
# This script automates the setup of the AppFlowy Web E2E testing environment,
# including Docker backend services, the web dev server, and test execution.
#
# Prerequisites:
#   - node & npm (for the web app and tests)
#   - docker & docker compose (for backend services)
#   - A local clone of AppFlowy-Cloud (https://github.com/AppFlowy-IO/AppFlowy-Cloud)
#
# Quick start:
#   1. Clone AppFlowy-Cloud next to this repo (or set APPFLOWY_CLOUD_DIR)
#   2. Run: ./setup-test-environment.sh setup
#   3. Run: ./setup-test-environment.sh test
#
# Configuration:
#   APPFLOWY_WEB_DIR   - Path to the AppFlowy-Web repo (default: this script's directory)
#   APPFLOWY_CLOUD_DIR - Path to the AppFlowy-Cloud repo (default: ../AppFlowy-Cloud)
#
# Usage: ./setup-test-environment.sh [command]
# Commands:
#   setup     - Complete environment setup (first time)
#   start     - Start all services (Docker + web server)
#   stop      - Stop all services
#   test      - Run all E2E tests
#   test:spec <path> - Run a specific test file
#   test:headed      - Open Cypress Test Runner (interactive)
#   clean     - Clean up Docker volumes and containers
#   status    - Check service status
#   help      - Show this help message
################################################################################

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project paths (override via environment variables)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APPFLOWY_WEB_DIR="${APPFLOWY_WEB_DIR:-$SCRIPT_DIR}"
APPFLOWY_CLOUD_DIR="${APPFLOWY_CLOUD_DIR:-$(dirname "$SCRIPT_DIR")/AppFlowy-Cloud}"

# Environment variables for external/frontend use
export APPFLOWY_BASE_URL="http://localhost"
export APPFLOWY_WS_BASE_URL="ws://localhost/ws/v2"
# Note: APPFLOWY_GOTRUE_BASE_URL is set in .env file for internal Docker communication
export APPFLOWY_WEB_VERSION="local-$(cd "$APPFLOWY_WEB_DIR" && git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

# Test configuration
CYPRESS_BASE_URL="http://localhost:3000"
WEB_DEV_SERVER_PID_FILE="/tmp/appflowy-web-dev.pid"

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is not installed"
        return 1
    fi
    log_success "$1 is installed"
    return 0
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    local all_good=true

    check_command "node" || all_good=false
    check_command "npm" || all_good=false
    check_command "docker" || all_good=false

    if [ "$all_good" = false ]; then
        log_error "Some prerequisites are missing. Please install them first."
        exit 1
    fi

    log_success "All prerequisites are installed"
}

check_directories() {
    log_info "Checking project directories..."

    if [ ! -d "$APPFLOWY_WEB_DIR" ]; then
        log_error "AppFlowy-Web directory not found at: $APPFLOWY_WEB_DIR"
        log_error "Set APPFLOWY_WEB_DIR to the correct path, e.g.:"
        log_error "  export APPFLOWY_WEB_DIR=/path/to/AppFlowy-Web"
        exit 1
    fi

    if [ ! -d "$APPFLOWY_CLOUD_DIR" ]; then
        log_error "AppFlowy-Cloud directory not found at: $APPFLOWY_CLOUD_DIR"
        log_error "Either clone it next to this repo:"
        log_error "  git clone https://github.com/AppFlowy-IO/AppFlowy-Cloud.git $(dirname "$SCRIPT_DIR")/AppFlowy-Cloud"
        log_error "Or set APPFLOWY_CLOUD_DIR to the correct path, e.g.:"
        log_error "  export APPFLOWY_CLOUD_DIR=/path/to/AppFlowy-Cloud"
        exit 1
    fi

    log_success "Project directories found"
    log_info "  Web:   $APPFLOWY_WEB_DIR"
    log_info "  Cloud: $APPFLOWY_CLOUD_DIR"
}

################################################################################
# Docker Management
################################################################################

setup_docker_env() {
    log_info "Setting up Docker environment..."

    cd "$APPFLOWY_CLOUD_DIR"

    # Copy .env.nginx to .env if it doesn't exist
    if [ ! -f .env ]; then
        if [ -f .env.nginx ]; then
            cp .env.nginx .env
            log_success "Created .env from .env.nginx"
        else
            log_error ".env.nginx not found in $APPFLOWY_CLOUD_DIR"
            log_error "Make sure you have the correct AppFlowy-Cloud repo checked out."
            exit 1
        fi
    fi

    # Set required environment variables in .env
    sed -i.bak "s|APPFLOWY_WEB_VERSION=.*|APPFLOWY_WEB_VERSION=$APPFLOWY_WEB_VERSION|g" .env 2>/dev/null || true
}

start_docker_services() {
    log_info "Starting Docker services..."

    cd "$APPFLOWY_CLOUD_DIR"

    # Stop any existing services
    docker compose down 2>/dev/null || true

    # Clean up orphan containers
    docker compose down --remove-orphans 2>/dev/null || true

    # Start services
    docker compose up -d

    log_info "Waiting for services to be healthy..."

    # Wait for postgres
    local retries=30
    while [ $retries -gt 0 ]; do
        if docker compose ps | grep -q "postgres.*healthy"; then
            log_success "Postgres is healthy"
            break
        fi
        sleep 2
        retries=$((retries - 1))
    done

    # Wait for gotrue
    retries=30
    while [ $retries -gt 0 ]; do
        if docker compose ps | grep -q "gotrue.*healthy"; then
            log_success "GoTrue is healthy"
            break
        fi
        sleep 2
        retries=$((retries - 1))
    done

    # Additional wait for all services to stabilize
    sleep 10

    log_success "Docker services are running"
}

stop_docker_services() {
    log_info "Stopping Docker services..."

    cd "$APPFLOWY_CLOUD_DIR"
    docker compose down

    log_success "Docker services stopped"
}

clean_docker_environment() {
    log_warning "This will remove all Docker containers and volumes for AppFlowy"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$APPFLOWY_CLOUD_DIR"
        docker compose down -v
        docker system prune -f
        log_success "Docker environment cleaned"
    else
        log_info "Clean operation cancelled"
    fi
}

################################################################################
# Web Server Management
################################################################################

start_web_dev_server() {
    log_info "Starting web development server..."

    cd "$APPFLOWY_WEB_DIR"

    # Kill any existing dev server
    stop_web_dev_server

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_info "Installing npm dependencies..."
        npm install
    fi

    # Start dev server in background
    npm run dev > /tmp/appflowy-web-dev.log 2>&1 &
    echo $! > "$WEB_DEV_SERVER_PID_FILE"

    # Wait for server to be ready
    log_info "Waiting for web server to be ready..."
    local retries=30
    while [ $retries -gt 0 ]; do
        if curl -s http://localhost:3000 > /dev/null 2>&1; then
            log_success "Web development server is running on port 3000"
            return 0
        fi
        sleep 2
        retries=$((retries - 1))
    done

    log_error "Web server failed to start. Check /tmp/appflowy-web-dev.log"
    return 1
}

stop_web_dev_server() {
    if [ -f "$WEB_DEV_SERVER_PID_FILE" ]; then
        local pid=$(cat "$WEB_DEV_SERVER_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            log_info "Stopped web development server (PID: $pid)"
        fi
        rm "$WEB_DEV_SERVER_PID_FILE"
    fi

    # Also kill any process on port 3000
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
}

################################################################################
# Test Execution
################################################################################

run_all_tests() {
    log_info "Running all E2E tests..."

    cd "$APPFLOWY_WEB_DIR"

    # Ensure services are running
    check_services_status || start_all_services

    # Run tests
    npm run test:integration
}

run_specific_test() {
    local test_spec=$1
    log_info "Running specific test: $test_spec"

    cd "$APPFLOWY_WEB_DIR"

    # Ensure services are running
    check_services_status || start_all_services

    # Run specific test
    npx cypress run --spec "$test_spec"
}

run_test_headed() {
    log_info "Opening Cypress Test Runner..."

    cd "$APPFLOWY_WEB_DIR"

    # Ensure services are running
    check_services_status || start_all_services

    # Open Cypress
    npm run cypress:open
}

################################################################################
# Status and Monitoring
################################################################################

check_services_status() {
    local all_running=true

    echo "================================"
    echo "Service Status Check"
    echo "================================"

    # Check Docker services
    cd "$APPFLOWY_CLOUD_DIR"
    if docker compose ps | grep -q "running"; then
        echo -e "${GREEN}✓${NC} Docker services: Running"
        docker compose ps --format "table {{.Name}}\t{{.Status}}"
    else
        echo -e "${RED}✗${NC} Docker services: Not running"
        all_running=false
    fi

    echo ""

    # Check web dev server
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Web dev server: Running on port 3000"
    else
        echo -e "${RED}✗${NC} Web dev server: Not running"
        all_running=false
    fi

    echo "================================"

    if [ "$all_running" = true ]; then
        return 0
    else
        return 1
    fi
}

################################################################################
# Main Functions
################################################################################

setup_complete_environment() {
    log_info "Setting up complete test environment..."

    check_prerequisites
    check_directories
    setup_docker_env
    start_docker_services
    start_web_dev_server

    log_success "Test environment setup complete!"
    echo ""
    check_services_status
    echo ""
    log_info "You can now run tests with: $0 test"
}

start_all_services() {
    log_info "Starting all services..."

    start_docker_services
    start_web_dev_server

    log_success "All services started"
}

stop_all_services() {
    log_info "Stopping all services..."

    stop_web_dev_server
    stop_docker_services

    log_success "All services stopped"
}

show_help() {
    cat << EOF
AppFlowy E2E Test Environment Setup Script

Usage: $0 [command] [options]

Commands:
    setup           Complete environment setup (first time)
    start           Start all services (Docker + Web server)
    stop            Stop all services
    status          Check service status
    test            Run all E2E tests
    test:spec PATH  Run specific test file
    test:headed     Open Cypress Test Runner (interactive)
    clean           Clean up Docker volumes and containers
    help            Show this help message

Examples:
    $0 setup                    # First time setup
    $0 start                    # Start services
    $0 test                     # Run all tests
    $0 test:spec cypress/e2e/page/create-delete-page.cy.ts
    $0 status                   # Check if everything is running

Configuration (via environment variables):
    APPFLOWY_WEB_DIR    Path to AppFlowy-Web repo   (current: $APPFLOWY_WEB_DIR)
    APPFLOWY_CLOUD_DIR  Path to AppFlowy-Cloud repo (current: $APPFLOWY_CLOUD_DIR)

    Example:
      APPFLOWY_CLOUD_DIR=/path/to/AppFlowy-Cloud $0 setup

Prerequisites:
    - node, npm        https://nodejs.org/
    - docker           https://docs.docker.com/get-docker/
    - AppFlowy-Cloud    https://github.com/AppFlowy-IO/AppFlowy-Cloud
                        Clone it next to this repo, or set APPFLOWY_CLOUD_DIR.

Troubleshooting:
    "No space left on device"  ->  docker system prune -a --volumes -f
    Port already in use        ->  lsof -ti:3000 | xargs kill -9
    Services unhealthy         ->  $0 stop && $0 start

EOF
}

################################################################################
# Main Script Entry Point
################################################################################

main() {
    case "${1:-help}" in
        setup)
            setup_complete_environment
            ;;
        start)
            start_all_services
            ;;
        stop)
            stop_all_services
            ;;
        status)
            check_services_status
            ;;
        test)
            run_all_tests
            ;;
        test:spec)
            if [ -z "$2" ]; then
                log_error "Please specify a test file path"
                exit 1
            fi
            run_specific_test "$2"
            ;;
        test:headed)
            run_test_headed
            ;;
        clean)
            clean_docker_environment
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
